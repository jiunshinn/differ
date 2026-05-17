import { spawn } from 'node:child_process';
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
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runGit(args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...opts.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        LANG: 'C',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || (opts.allowNonZeroCodes && code !== null && opts.allowNonZeroCodes.includes(code))) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new GitError(stderr.trim() || stdout.trim(), code, args.join(' ')));
      }
    });
    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
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

export async function getStatus(cwd: string): Promise<RepoStatus> {
  const r = await runGit(['status', '--porcelain=v2', '--branch', '-z'], { cwd });
  return parsePorcelainV2(r.stdout);
}

function parsePorcelainV2(out: string): RepoStatus {
  const result: RepoStatus = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
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
      const space = tok.indexOf(' ', 2);
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
      // Unmerged
      const xy = tok.slice(2, 4);
      const rest = tok.slice(5).split(' ');
      const filePath = rest.slice(9).join(' ');
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
  const r = await runGit(['log', `-n`, String(limit), `--pretty=format:${format}`], { cwd });
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
      files.push(current);
      current = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      finalizeFile();
      // Parse "diff --git a/<old> b/<new>"
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const oldPath = match?.[1] ?? null;
      const newPath = match?.[2] ?? oldPath ?? '';
      current = {
        filePath: newPath,
        oldPath: oldPath && oldPath !== newPath ? oldPath : null,
        isBinary: false,
        isNew: false,
        isDeleted: false,
        isRenamed: !!(oldPath && oldPath !== newPath),
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
      current.oldPath = line.slice('rename from '.length);
      current.isRenamed = true;
      i++;
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.filePath = line.slice('rename to '.length);
      i++;
      continue;
    }
    if (line.startsWith('Binary files ')) {
      current.isBinary = true;
      i++;
      continue;
    }
    if (line.startsWith('--- ')) {
      // Skip
      i++;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const after = line.slice(4);
      if (after !== '/dev/null') {
        current.filePath = after.replace(/^b\//, '');
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

export async function getDiff(cwd: string, opts: DiffOptions): Promise<FileDiff[]> {
  const all: FileDiff[] = [];
  if (opts.base && opts.head) {
    const args = ['diff', '--no-color', '-U3'];
    if (opts.ignoreWhitespace) args.push('-w');
    args.push(`${opts.base}..${opts.head}`);
    if (opts.filePath) args.push('--', opts.filePath);
    const r = await runGit(args, { cwd, allowNonZeroCodes: [1] });
    all.push(...parseUnifiedDiff(r.stdout));
    return all;
  }
  const args = ['diff', '--no-color', '-U3'];
  if (opts.staged) args.push('--cached');
  if (opts.ignoreWhitespace) args.push('-w');
  if (opts.filePath) args.push('--', opts.filePath);
  const r = await runGit(args, { cwd, allowNonZeroCodes: [1] });
  all.push(...parseUnifiedDiff(r.stdout));

  // Untracked: synthesize an all-add diff against /dev/null per file.
  if (opts.includeUntracked && !opts.staged) {
    const statusResult = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd });
    const tokens = statusResult.stdout.split('\0').filter(Boolean);
    const untracked: string[] = [];
    for (const t of tokens) {
      if (t.startsWith('?? ')) {
        const p = t.slice(3);
        if (!opts.filePath || opts.filePath === p) untracked.push(p);
      }
    }
    for (const p of untracked) {
      const synth = await synthesizeUntrackedDiff(cwd, p);
      if (synth) all.push(synth);
    }
  }
  return all;
}

async function synthesizeUntrackedDiff(cwd: string, filePath: string): Promise<FileDiff | null> {
  const abs = path.join(cwd, filePath);
  if (!fs.existsSync(abs)) return null;
  let buf: Buffer;
  try {
    buf = fs.readFileSync(abs);
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
  await runGit(['add', '--', filePath], { cwd });
}

export async function unstageFile(cwd: string, filePath: string): Promise<void> {
  // `git restore --staged` is the modern equivalent.
  await runGit(['restore', '--staged', '--', filePath], { cwd, allowNonZeroCodes: [1] });
}

export async function discardFile(cwd: string, filePath: string): Promise<void> {
  await runGit(['restore', '--worktree', '--', filePath], { cwd, allowNonZeroCodes: [1] });
}

export async function commit(cwd: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Commit message cannot be empty');
  await runGit(['commit', '-m', message], { cwd });
}

export async function amend(cwd: string, message: string | null): Promise<void> {
  const args = ['commit', '--amend'];
  if (message !== null) args.push('-m', message);
  else args.push('--no-edit');
  await runGit(args, { cwd });
}

export async function fetch(cwd: string): Promise<void> {
  await runGit(['fetch', '--all', '--prune'], { cwd });
}

export async function pull(cwd: string): Promise<void> {
  await runGit(['pull', '--ff-only'], { cwd });
}

export async function push(cwd: string, opts: { setUpstream?: boolean } = {}): Promise<void> {
  if (opts.setUpstream) {
    const status = await getStatus(cwd);
    if (!status.branch) throw new Error('Cannot push from detached HEAD');
    await runGit(['push', '-u', 'origin', status.branch], { cwd });
  } else {
    await runGit(['push'], { cwd });
  }
}

export async function checkout(cwd: string, branch: string): Promise<void> {
  await runGit(['checkout', branch], { cwd });
}

export async function createBranch(cwd: string, branch: string, doCheckout: boolean): Promise<void> {
  if (doCheckout) {
    await runGit(['checkout', '-b', branch], { cwd });
  } else {
    await runGit(['branch', branch], { cwd });
  }
}

// Hunk-level staging. We build a minimal patch with just the requested hunk and pipe it to `git apply`.

export async function applyHunkPatch(cwd: string, patch: string, opts: { reverse?: boolean; cached: boolean }): Promise<void> {
  const args = ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn'];
  if (opts.reverse) args.push('--reverse');
  if (!opts.cached) {
    // remove --cached
    args.splice(args.indexOf('--cached'), 1);
  }
  await runGit(args, { cwd, input: patch });
}

export function buildSingleHunkPatch(file: FileDiff, hunk: DiffHunk): string {
  // Important: when applying to the index with --cached, the header for renames is unnecessary.
  // We use a simple, conservative patch format that matches the file's current new path.
  const header =
    `diff --git a/${file.oldPath ?? file.filePath} b/${file.filePath}\n` +
    `--- a/${file.oldPath ?? file.filePath}\n` +
    `+++ b/${file.filePath}\n`;
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
  const patch = buildSingleHunkPatch(file, hunk);
  await runGit(['apply', '--cached', '--whitespace=nowarn'], { cwd, input: patch });
}

export async function unstageHunk(cwd: string, file: FileDiff, hunk: DiffHunk): Promise<void> {
  const patch = buildSingleHunkPatch(file, hunk);
  await runGit(['apply', '--cached', '--reverse', '--whitespace=nowarn'], { cwd, input: patch });
}

export async function getHeadSha(cwd: string): Promise<string | null> {
  try {
    const r = await runGit(['rev-parse', 'HEAD'], { cwd });
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getMergeBase(cwd: string, a: string, b: string): Promise<string | null> {
  try {
    const r = await runGit(['merge-base', a, b], { cwd });
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

export function parseGithubFromRemote(remoteUrl: string | null): { owner: string; repo: string } | null {
  if (!remoteUrl) return null;
  // git@github.com:owner/repo(.git)
  let m = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  // https://github.com/owner/repo(.git)
  m = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/.*)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  // ssh://git@github.com/owner/repo(.git)
  m = remoteUrl.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}
