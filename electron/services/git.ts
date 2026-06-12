import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type {
  BranchInfo,
  ChangedFile,
  CommitSummary,
  DiffHunk,
  DiffLine,
  DiffOptions,
  FileDiff,
  RepoStatus,
  WorkingTreeGroup,
} from '../../shared/types';

export class GitError extends Error {
  constructor(public stderr: string, public code: number | null, public command: string) {
    super(stderr || `git ${command} failed`);
    this.name = 'GitError';
  }
}

interface RunOptions {
  cwd: string;
  input?: string | Buffer;
  // Treat non-zero exit codes as success (used by git diff which returns 1 when diffs exist).
  allowNonZeroCodes?: number[];
  env?: NodeJS.ProcessEnv;
  // Kill the child and reject after this many milliseconds (used for network commands).
  timeoutMs?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

// Default timeout for network operations (fetch/pull/push/clone/sync) so a stalled
// connection or an ssh prompt cannot hang the UI forever.
const NETWORK_TIMEOUT_MS = 120_000;

// Track every live git child so we can terminate them on app quit (see killAllGitProcesses).
const liveChildren = new Set<ChildProcess>();

// Best-effort termination of all in-flight git children. Called from the main process's
// before-quit handler so quitting mid-clone/fetch does not orphan git processes.
export function killAllGitProcesses(): void {
  for (const child of liveChildren) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  liveChildren.clear();
}

export function runGit(args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        // Fail fast instead of prompting on /dev/tty for ssh host-key / passphrase input.
        GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
        ...opts.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        LANG: 'C',
      },
    });
    liveChildren.add(child);
    // Accumulate raw Buffers and decode once at the end so multibyte UTF-8 sequences that
    // straddle a pipe-chunk boundary are not corrupted into U+FFFD replacement characters.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      liveChildren.delete(child);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    child.stdout.on('data', (d: Buffer) => {
      stdoutChunks.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderrChunks.push(d);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0 || (opts.allowNonZeroCodes && code !== null && opts.allowNonZeroCodes.includes(code))) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new GitError(stderr.trim() || stdout.trim(), code, args.join(' ')));
      }
    });
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        reject(new GitError(`git ${args.join(' ')} timed out after ${opts.timeoutMs}ms`, null, args.join(' ')));
      }, opts.timeoutMs);
    }
    if (opts.input !== undefined) {
      // git may exit before draining stdin (e.g. a startup fatal error) — without an 'error'
      // listener the resulting EPIPE becomes an uncaught exception in the main process.
      child.stdin.on('error', () => {
        /* the close handler reports the real failure via exit code/stderr */
      });
      child.stdin.end(opts.input);
    }
  });
}

// Per-repo serialization for index-mutating commands. Concurrent add/restore/apply/commit
// races on `.git/index.lock`; this promise queue (keyed by repo cwd) runs them one at a time
// per repository while leaving read-only commands fully parallel.
const repoQueues = new Map<string, Promise<unknown>>();

function withRepoLock<T>(cwd: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(cwd);
  const prev = repoQueues.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  // Keep the chain alive even if a task rejects; drop the entry once it is the tail.
  const tail = run.catch(() => undefined);
  repoQueues.set(key, tail);
  void tail.then(() => {
    if (repoQueues.get(key) === tail) repoQueues.delete(key);
  });
  return run;
}

export async function clone(
  remoteUrl: string,
  destDir: string,
  opts: { authToken?: string | null } = {},
): Promise<string> {
  if (!remoteUrl.trim()) throw new Error('Remote URL is required');
  if (!destDir.trim()) throw new Error('Destination directory is required');
  if (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) {
    throw new Error(`Destination already exists and is not empty: ${destDir}`);
  }
  const parent = path.dirname(destDir);
  if (!fs.existsSync(parent)) {
    throw new Error(`Parent directory does not exist: ${parent}`);
  }
  const destExistedBefore = fs.existsSync(destDir);
  // For HTTPS github.com URLs, inject the OAuth token via http.extraHeader so it
  // is not persisted into the cloned repository's .git/config. The config is passed via
  // environment (GIT_CONFIG_*) rather than `-c key=value` so the base64 token never lands
  // in the process argv (readable by other local processes via ps for the clone's duration).
  const env: NodeJS.ProcessEnv = {};
  if (opts.authToken && /^https?:\/\/github\.com\//i.test(remoteUrl)) {
    const basic = Buffer.from(`x-access-token:${opts.authToken}`).toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
  }
  try {
    await runGit(['clone', '--', remoteUrl, destDir], { cwd: parent, env, timeoutMs: NETWORK_TIMEOUT_MS });
  } catch (err) {
    // Remove a partially written destination this clone created so the user can retry to the
    // same folder (the pre-check above rejects a non-empty existing destination).
    if (!destExistedBefore && fs.existsSync(destDir)) {
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
      } catch {
        /* leave it for the user to clean up */
      }
    }
    throw err;
  }
  return destDir;
}

export async function isGitRepo(dir: string): Promise<boolean> {
  if (!fs.existsSync(dir)) return false;
  try {
    const r = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return r.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function getRepoTopLevel(dir: string): Promise<string> {
  const r = await runGit(['rev-parse', '--show-toplevel'], { cwd: dir });
  return r.stdout.trim();
}

export async function getRemoteUrl(cwd: string, remote = 'origin'): Promise<string | null> {
  try {
    const r = await runGit(['remote', 'get-url', remote], { cwd });
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const r = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd });
    const value = r.stdout.trim();
    return value.replace(/^origin\//, '') || null;
  } catch {
    // Fall back to main/master if present.
    for (const candidate of ['main', 'master']) {
      try {
        await runGit(['rev-parse', '--verify', candidate], { cwd });
        return candidate;
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

// Cache the absolute git dir per repo cwd — it is constant for a given repository and lets us
// resolve operation-state files with plain fs checks instead of spawning rev-parse every call.
const gitDirCache = new Map<string, string>();

async function getAbsoluteGitDir(cwd: string): Promise<string | null> {
  const key = path.resolve(cwd);
  const cached = gitDirCache.get(key);
  if (cached) return cached;
  try {
    const r = await runGit(['rev-parse', '--absolute-git-dir'], { cwd });
    const dir = r.stdout.trim();
    if (!dir) return null;
    gitDirCache.set(key, dir);
    return dir;
  } catch {
    return null;
  }
}

export async function getOperationState(cwd: string): Promise<{ rebaseInProgress: boolean; mergeInProgress: boolean }> {
  const gitDir = await getAbsoluteGitDir(cwd);
  if (!gitDir) return { rebaseInProgress: false, mergeInProgress: false };
  // --git-path emits paths relative to the git process cwd for ordinary repos, so resolving
  // them against the (possibly unrelated) Electron process cwd is wrong. Build them from the
  // absolute git dir instead.
  const rebaseInProgress =
    fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'));
  const mergeInProgress = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
  return { rebaseInProgress, mergeInProgress };
}

export async function getStatus(cwd: string): Promise<RepoStatus> {
  const [r, op] = await Promise.all([
    runGit(['status', '--porcelain=v2', '--branch', '-z'], { cwd }),
    getOperationState(cwd),
  ]);
  const status = parsePorcelainV2(r.stdout);
  status.rebaseInProgress = op.rebaseInProgress;
  status.mergeInProgress = op.mergeInProgress;
  return status;
}

function parsePorcelainV2(out: string): RepoStatus {
  const result: RepoStatus = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
    rebaseInProgress: false,
    mergeInProgress: false,
  };
  // Records are NUL-separated. But rename records contain an extra NUL-separated original path,
  // so we tokenize manually with a stateful walker.
  const tokens = out.split('\0');
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === '' && i === tokens.length - 1) break;
    if (tok.startsWith('# ')) {
      // Header lines like "# branch.head main"
      const parts = tok.slice(2).split(' ');
      const key = parts[0];
      if (key === 'branch.head') {
        const value = parts.slice(1).join(' ');
        if (value === '(detached)') {
          result.detached = true;
        } else {
          result.branch = value;
        }
      } else if (key === 'branch.upstream') {
        result.upstream = parts.slice(1).join(' ');
      } else if (key === 'branch.ab') {
        // +N -M
        const aheadStr = parts[1] || '+0';
        const behindStr = parts[2] || '-0';
        result.ahead = parseInt(aheadStr.replace('+', ''), 10) || 0;
        result.behind = parseInt(behindStr.replace('-', ''), 10) || 0;
      }
      i++;
      continue;
    }
    if (tok.startsWith('1 ')) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const xy = tok.slice(2, 4);
      const rest = tok.slice(5).split(' ');
      const filePath = rest.slice(6).join(' ');
      result.files.push(buildChangedFile(xy, filePath, null));
      i++;
      continue;
    }
    if (tok.startsWith('2 ')) {
      // Renamed/copied. The next token is the original path.
      const xy = tok.slice(2, 4);
      const rest = tok.slice(5).split(' ');
      // last token before original-path is new path; rest[7] expected.
      const filePath = rest.slice(7).join(' ');
      const origPath = tokens[i + 1] ?? null;
      result.files.push(buildChangedFile(xy, filePath, origPath));
      i += 2;
      continue;
    }
    if (tok.startsWith('u ')) {
      // Unmerged: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      // After stripping "u XY " the fields are [sub, m1, m2, m3, mW, h1, h2, h3, path...],
      // so the path begins at index 8 (not 9).
      const xy = tok.slice(2, 4);
      const rest = tok.slice(5).split(' ');
      const filePath = rest.slice(8).join(' ');
      result.files.push({
        path: filePath,
        oldPath: null,
        group: 'conflicted',
        indexStatus: xy[0],
        worktreeStatus: xy[1],
        renamed: false,
      });
      i++;
      continue;
    }
    if (tok.startsWith('? ')) {
      const filePath = tok.slice(2);
      result.files.push({
        path: filePath,
        oldPath: null,
        group: 'untracked',
        indexStatus: '?',
        worktreeStatus: '?',
        renamed: false,
      });
      i++;
      continue;
    }
    if (tok.startsWith('! ')) {
      // ignored — skip
      i++;
      continue;
    }
    i++;
  }
  // Some files appear with both index and worktree changes; we still report once via the group inference.
  return result;
}

function buildChangedFile(xy: string, filePath: string, origPath: string | null): ChangedFile {
  const x = xy[0];
  const y = xy[1];
  const group = inferGroup(x, y);
  return {
    path: filePath,
    oldPath: origPath,
    group,
    indexStatus: x,
    worktreeStatus: y,
    renamed: x === 'R' || y === 'R',
  };
}

function inferGroup(x: string, y: string): WorkingTreeGroup {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted';
  // If worktree has changes (y != '.'), the file is unstaged. If index has changes (x != '.') it's staged.
  if (y !== '.' && x === '.') return 'unstaged';
  if (x !== '.' && y === '.') return 'staged';
  if (x !== '.' && y !== '.') return 'unstaged'; // partially staged shows as unstaged for the unstaged piece
  return 'unstaged';
}

export async function getCommits(cwd: string, limit = 30): Promise<CommitSummary[]> {
  const sep = '';
  const recSep = '';
  const format = ['%H', '%h', '%s', '%an', '%ae', '%aI'].join(sep) + recSep;
  let r: RunResult;
  try {
    r = await runGit(['log', `-n`, String(limit), `--pretty=format:${format}`], { cwd });
  } catch (err) {
    // A freshly-initialized repo with no commits makes `git log` exit 128
    // ('does not have any commits yet') — that is an empty history, not an error.
    if (err instanceof GitError && /does not have any commits yet|bad default revision/i.test(err.stderr)) {
      return [];
    }
    throw err;
  }
  const records = r.stdout.split(recSep).map((s) => s.trim()).filter(Boolean);
  return records.map((rec) => {
    const [sha, shortSha, subject, authorName, authorEmail, authorDate] = rec.split(sep);
    return { sha, shortSha, subject, authorName, authorEmail, authorDate };
  });
}

export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  const r = await runGit(
    [
      'for-each-ref',
      '--format=%(HEAD)\t%(refname:short)\t%(upstream:short)\t%(upstream:track)',
      'refs/heads',
    ],
    { cwd },
  );
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [head, name, upstream, track] = line.split('\t');
      let ahead = 0;
      let behind = 0;
      if (track) {
        const aheadMatch = track.match(/ahead (\d+)/);
        const behindMatch = track.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
      }
      return {
        name,
        isCurrent: head === '*',
        upstream: upstream || null,
        ahead,
        behind,
      };
    });
}

// Diff parsing — works on the output of `git diff --no-color -U3` style commands.

// Decode a path that git may have wrapped in double quotes with C-style octal escapes
// (happens when core.quotepath is on, or for paths with special characters even when off).
function unquoteDiffPath(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
    const bytes: number[] = [];
    for (let j = 0; j < s.length; j++) {
      if (s[j] === '\\' && j + 1 < s.length) {
        const next = s[j + 1];
        if (next >= '0' && next <= '7') {
          // Octal escape \nnn -> raw byte (UTF-8 components arrive as separate escapes).
          const oct = s.slice(j + 1, j + 4);
          bytes.push(parseInt(oct, 8) & 0xff);
          j += oct.length;
          continue;
        }
        const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
        if (next in simple) {
          bytes.push(simple[next]);
          j += 1;
          continue;
        }
      }
      // Plain character: push its UTF-8 bytes.
      for (const b of Buffer.from(s[j], 'utf8')) bytes.push(b);
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return s;
}

export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  if (!diffText.trim()) return files;

  const lines = diffText.split('\n');
  let i = 0;
  let current: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finalizeHunk = (): void => {
    if (current && hunk) {
      current.hunks.push(hunk);
      hunk = null;
    }
  };
  const finalizeFile = (): void => {
    finalizeHunk();
    if (current) {
      // A provisional old path from the ambiguous "diff --git" line can equal the real path; only a
      // genuine rename (set via "rename from"/"rename to") has a distinct old path.
      if (current.oldPath !== null && current.oldPath === current.filePath) {
        current.oldPath = null;
        current.isRenamed = false;
      }
      files.push(current);
      current = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      finalizeFile();
      // The "diff --git a/<old> b/<new>" line is ambiguous for paths containing ' b/' and may be
      // quoted, so derive only a provisional path here; the authoritative paths come from the
      // ---/+++ and rename from/to lines below.
      let provisional = '';
      const rest = line.slice('diff --git '.length);
      const quoted = rest.match(/^"((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/);
      if (quoted) {
        provisional = unquoteDiffPath(`"${quoted[2]}"`).replace(/^b\//, '');
      } else {
        const m = rest.match(/^a\/(.+) b\/(.+)$/);
        if (m) provisional = m[2];
      }
      current = {
        filePath: provisional,
        oldPath: null,
        isBinary: false,
        isNew: false,
        isDeleted: false,
        isRenamed: false,
        hunks: [],
      };
      i++;
      continue;
    }
    if (!current) {
      i++;
      continue;
    }
    if (line.startsWith('new file mode')) {
      current.isNew = true;
      i++;
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.isDeleted = true;
      i++;
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.oldPath = unquoteDiffPath(line.slice('rename from '.length));
      current.isRenamed = true;
      i++;
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.filePath = unquoteDiffPath(line.slice('rename to '.length));
      i++;
      continue;
    }
    if (line.startsWith('Binary files ')) {
      current.isBinary = true;
      i++;
      continue;
    }
    if (line.startsWith('--- ')) {
      // Authoritative old path (prefer over the ambiguous "diff --git" line).
      const after = line.slice(4).trim();
      if (after !== '/dev/null') {
        const old = unquoteDiffPath(after).replace(/^a\//, '');
        if (old) current.oldPath = old === current.filePath ? null : old;
      }
      i++;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const after = line.slice(4).trim();
      if (after !== '/dev/null') {
        current.filePath = unquoteDiffPath(after).replace(/^b\//, '');
      }
      i++;
      continue;
    }
    if (line.startsWith('@@')) {
      finalizeHunk();
      // @@ -oldStart,oldLines +newStart,newLines @@ optional section heading
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const oldLines = match[2] ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newLines = match[4] ? parseInt(match[4], 10) : 1;
        hunk = {
          header: line,
          oldStart,
          oldLines,
          newStart,
          newLines,
          lines: [],
        };
        oldLine = oldStart;
        newLine = newStart;
      }
      i++;
      continue;
    }
    if (hunk) {
      if (line.startsWith('\\ No newline at end of file')) {
        hunk.lines.push({ kind: 'meta', content: line, oldLineNumber: null, newLineNumber: null });
        i++;
        continue;
      }
      const first = line[0];
      const content = line.slice(1);
      if (first === '+') {
        hunk.lines.push({ kind: 'add', content, oldLineNumber: null, newLineNumber: newLine });
        newLine++;
      } else if (first === '-') {
        hunk.lines.push({ kind: 'del', content, oldLineNumber: oldLine, newLineNumber: null });
        oldLine++;
      } else if (first === ' ' || first === undefined) {
        hunk.lines.push({
          kind: 'context',
          content,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        });
        oldLine++;
        newLine++;
      } else {
        // Unknown line in hunk body; treat as meta to be safe.
        hunk.lines.push({ kind: 'meta', content: line, oldLineNumber: null, newLineNumber: null });
      }
    }
    i++;
  }
  finalizeFile();
  return files;
}

// Cap how many untracked files we synthesize per diff call so a large untracked tree (fresh
// clone, build output) cannot read the whole working tree into the main process at once.
const MAX_UNTRACKED_SYNTH = 200;

export async function getDiff(cwd: string, opts: DiffOptions): Promise<FileDiff[]> {
  const all: FileDiff[] = [];
  // core.quotepath=false keeps non-ASCII paths un-escaped in diff headers so the parser can read them.
  if (opts.base && opts.head) {
    const args = ['-c', 'core.quotepath=false', 'diff', '--no-color', '-U3'];
    if (opts.ignoreWhitespace) args.push('-w');
    // 3-dot (merge-base) semantics match what github.com shows for a PR; --end-of-options stops
    // a ref beginning with '-' from being parsed as a git option.
    args.push('--end-of-options', `${opts.base}...${opts.head}`);
    if (opts.filePath) args.push('--', opts.filePath);
    const r = await runGit(args, { cwd, allowNonZeroCodes: [1] });
    all.push(...parseUnifiedDiff(r.stdout));
    return all;
  }
  const args = ['-c', 'core.quotepath=false', 'diff', '--no-color', '-U3'];
  if (opts.staged) args.push('--cached');
  if (opts.ignoreWhitespace) args.push('-w');
  if (opts.filePath) args.push('--', opts.filePath);
  const r = await runGit(args, { cwd, allowNonZeroCodes: [1] });
  all.push(...parseUnifiedDiff(r.stdout));

  // Untracked: synthesize an all-add diff against /dev/null per file.
  if (opts.includeUntracked && !opts.staged) {
    // Scope the (otherwise repo-wide) untracked scan to the single requested pathspec so loading
    // a tracked file's diff does not walk the entire working tree.
    const statusArgs = ['status', '--porcelain=v1', '-z', '--untracked-files=all'];
    if (opts.filePath) statusArgs.push('--', opts.filePath);
    const statusResult = await runGit(statusArgs, { cwd });
    const tokens = statusResult.stdout.split('\0').filter(Boolean);
    const untracked: string[] = [];
    for (const t of tokens) {
      if (t.startsWith('?? ')) {
        const p = t.slice(3);
        if (!opts.filePath || opts.filePath === p) untracked.push(p);
      }
    }
    const capped = untracked.slice(0, MAX_UNTRACKED_SYNTH);
    for (const p of capped) {
      const synth = await synthesizeUntrackedDiff(cwd, p);
      if (synth) all.push(synth);
    }
  }
  return all;
}

// Skip synthesizing a full additive diff for untracked files larger than this; emit a binary-like
// stub instead so a huge generated/vendored file cannot balloon main-process memory.
const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024; // 1MB

async function synthesizeUntrackedDiff(cwd: string, filePath: string): Promise<FileDiff | null> {
  const abs = path.join(cwd, filePath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
    // Treat as binary so the viewer renders a placeholder rather than the whole file.
    return {
      filePath,
      oldPath: null,
      isBinary: true,
      isNew: true,
      isDeleted: false,
      isRenamed: false,
      hunks: [],
    };
  }
  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(abs);
  } catch {
    return null;
  }
  // Best-effort binary detection: NUL byte in first 8KB.
  const head = buf.subarray(0, Math.min(buf.length, 8192));
  const isBinary = head.includes(0);
  if (isBinary) {
    return {
      filePath,
      oldPath: null,
      isBinary: true,
      isNew: true,
      isDeleted: false,
      isRenamed: false,
      hunks: [],
    };
  }
  const text = buf.toString('utf8');
  const lines = text.length === 0 ? [] : text.split(/\r?\n/);
  // If file ended without trailing newline, last element will be the last line (no separator).
  // Strip a trailing empty element only if the file ended with a newline.
  const endedWithNewline = text.endsWith('\n');
  const bodyLines = endedWithNewline && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  const diffLines: DiffLine[] = bodyLines.map((content, idx) => ({
    kind: 'add' as const,
    content,
    oldLineNumber: null,
    newLineNumber: idx + 1,
  }));
  if (!endedWithNewline && bodyLines.length > 0) {
    diffLines.push({
      kind: 'meta',
      content: '\\ No newline at end of file',
      oldLineNumber: null,
      newLineNumber: null,
    });
  }
  const hunk: DiffHunk = {
    header: `@@ -0,0 +1,${bodyLines.length} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: bodyLines.length,
    lines: diffLines,
  };
  return {
    filePath,
    oldPath: null,
    isBinary: false,
    isNew: true,
    isDeleted: false,
    isRenamed: false,
    hunks: bodyLines.length ? [hunk] : [],
  };
}

// Staging operations

export async function stageFile(cwd: string, filePath: string): Promise<void> {
  // `git add` handles tracked and untracked. Use -- to be safe with paths.
  await withRepoLock(cwd, () => runGit(['add', '--', filePath], { cwd }));
}

export async function unstageFile(cwd: string, filePath: string): Promise<void> {
  // `git restore --staged` is the modern equivalent. Unlike `git diff`, restore uses exit 1 for
  // genuine errors (e.g. a stale pathspec after a rename) — do not swallow it.
  await withRepoLock(cwd, () => runGit(['restore', '--staged', '--', filePath], { cwd }));
}

export async function discardFile(cwd: string, filePath: string): Promise<void> {
  await withRepoLock(cwd, async () => {
    // `git restore --worktree` cannot remove untracked files (it exits 1 and leaves the file).
    // Detect that case and delete the file from disk so the operation is not a silent no-op.
    const status = await runGit(['status', '--porcelain=v1', '-z', '--', filePath], { cwd });
    const isUntracked = status.stdout.split('\0').some((t) => t.startsWith('?? ') && t.slice(3) === filePath);
    if (isUntracked) {
      const abs = path.join(cwd, filePath);
      await fs.promises.rm(abs, { force: true });
      return;
    }
    await runGit(['restore', '--worktree', '--', filePath], { cwd });
  });
}

export async function commit(cwd: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Commit message cannot be empty');
  await withRepoLock(cwd, () => runGit(['commit', '-m', message], { cwd }));
}

export async function amend(cwd: string, message: string | null): Promise<void> {
  const args = ['commit', '--amend'];
  if (message !== null) args.push('-m', message);
  else args.push('--no-edit');
  await withRepoLock(cwd, () => runGit(args, { cwd }));
}

export async function fetch(cwd: string): Promise<void> {
  await runGit(['fetch', '--all', '--prune'], { cwd, timeoutMs: NETWORK_TIMEOUT_MS });
}

export async function pull(cwd: string, opts: { rebase?: boolean } = {}): Promise<void> {
  const args = ['pull'];
  if (opts.rebase) args.push('--rebase');
  else args.push('--ff-only');
  await withRepoLock(cwd, () => runGit(args, { cwd, timeoutMs: NETWORK_TIMEOUT_MS }));
}

export async function syncWithRemote(cwd: string): Promise<void> {
  // Pull --rebase first to integrate remote commits underneath local ones, then push.
  // If rebase encounters conflicts it pauses and exits non-zero — that surfaces as a GitError
  // so the UI can route the user to the Resolve view.
  await withRepoLock(cwd, async () => {
    await runGit(['pull', '--rebase'], { cwd, timeoutMs: NETWORK_TIMEOUT_MS });
    await runGit(['push'], { cwd, timeoutMs: NETWORK_TIMEOUT_MS });
  });
}

export async function push(cwd: string, opts: { setUpstream?: boolean } = {}): Promise<void> {
  if (opts.setUpstream) {
    const status = await getStatus(cwd);
    if (!status.branch) throw new Error('Cannot push from detached HEAD');
    await runGit(['push', '-u', 'origin', status.branch], { cwd, timeoutMs: NETWORK_TIMEOUT_MS });
  } else {
    await runGit(['push'], { cwd, timeoutMs: NETWORK_TIMEOUT_MS });
  }
}

export async function rebaseContinue(cwd: string): Promise<void> {
  // GIT_EDITOR=true skips the commit-message editor when continuing a rebase.
  await withRepoLock(cwd, () => runGit(['rebase', '--continue'], { cwd, env: { GIT_EDITOR: 'true' } }));
}

export async function rebaseAbort(cwd: string): Promise<void> {
  await withRepoLock(cwd, () => runGit(['rebase', '--abort'], { cwd }));
}

export async function mergeAbort(cwd: string): Promise<void> {
  await withRepoLock(cwd, () => runGit(['merge', '--abort'], { cwd }));
}

export async function checkout(cwd: string, branch: string): Promise<void> {
  // --no-guess refuses the pathspec fallback, so a name that is not a ref errors instead of
  // silently checking a matching file out of the index (which would discard worktree changes).
  // --end-of-options stops a name beginning with '-' from being parsed as a git option.
  await withRepoLock(cwd, () => runGit(['switch', '--no-guess', '--end-of-options', branch], { cwd }));
}

export async function createBranch(cwd: string, branch: string, doCheckout: boolean): Promise<void> {
  await withRepoLock(cwd, () => {
    if (doCheckout) {
      return runGit(['switch', '--create', branch], { cwd });
    }
    return runGit(['branch', '--end-of-options', branch], { cwd });
  });
}

// Hunk-level staging. We build a minimal patch with just the requested hunk and pipe it to `git apply`.

export function buildSingleHunkPatch(file: FileDiff, hunk: DiffHunk): string {
  // Emit a header that matches the file's status so `git apply --cached` accepts it. A modify-style
  // header on a new/deleted file makes git look for an index entry that does not exist (new) or that
  // it would wrongly keep (deleted), so use /dev/null + the mode line in those cases.
  let header: string;
  if (file.isNew) {
    header =
      `diff --git a/${file.filePath} b/${file.filePath}\n` +
      `new file mode 100644\n` +
      `--- /dev/null\n` +
      `+++ b/${file.filePath}\n`;
  } else if (file.isDeleted) {
    header =
      `diff --git a/${file.filePath} b/${file.filePath}\n` +
      `deleted file mode 100644\n` +
      `--- a/${file.filePath}\n` +
      `+++ /dev/null\n`;
  } else {
    header =
      `diff --git a/${file.oldPath ?? file.filePath} b/${file.filePath}\n` +
      `--- a/${file.oldPath ?? file.filePath}\n` +
      `+++ b/${file.filePath}\n`;
  }
  const hunkText = serializeHunk(hunk);
  return header + hunkText;
}

function serializeHunk(hunk: DiffHunk): string {
  let out = `${hunk.header}\n`;
  for (const l of hunk.lines) {
    if (l.kind === 'add') out += `+${l.content}\n`;
    else if (l.kind === 'del') out += `-${l.content}\n`;
    else if (l.kind === 'context') out += ` ${l.content}\n`;
    else out += `${l.content}\n`;
  }
  return out;
}

export async function stageHunk(cwd: string, file: FileDiff, hunk: DiffHunk): Promise<void> {
  await withRepoLock(cwd, () => {
    // An untracked file's diff has no index entry, so `git apply --cached` errors. Its synthesized
    // diff is a single whole-file hunk, so staging that hunk is just `git add`.
    if (file.isNew) {
      return runGit(['add', '--', file.filePath], { cwd });
    }
    const patch = buildSingleHunkPatch(file, hunk);
    return runGit(['apply', '--cached', '--whitespace=nowarn'], { cwd, input: patch });
  });
}

export async function unstageHunk(cwd: string, file: FileDiff, hunk: DiffHunk): Promise<void> {
  await withRepoLock(cwd, () => {
    // Reverse-applying a newly-added file's whole hunk leaves an empty blob staged instead of
    // removing it from the index, so unstage the file entirely via `git restore --staged`.
    if (file.isNew) {
      return runGit(['restore', '--staged', '--', file.filePath], { cwd });
    }
    const patch = buildSingleHunkPatch(file, hunk);
    return runGit(['apply', '--cached', '--reverse', '--whitespace=nowarn'], { cwd, input: patch });
  });
}

export function parseGithubFromRemote(remoteUrl: string | null): { owner: string; repo: string } | null {
  if (!remoteUrl) return null;
  const strip = (repo: string): string => repo.replace(/\.git$/i, '');
  // git@github.com:owner/repo(.git) — allow dots in the repo name (e.g. next.js).
  let m = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m) return { owner: m[1], repo: strip(m[2]) };
  // https://github.com/owner/repo(.git)
  m = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (m) return { owner: m[1], repo: strip(m[2]) };
  // ssh://git@github.com/owner/repo(.git)
  m = remoteUrl.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (m) return { owner: m[1], repo: strip(m[2]) };
  return null;
}
