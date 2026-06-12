import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileContent, TreeEntry } from '../../shared/types';

// Directories that are essentially never something a user wants to browse in a
// source tree: VCS metadata, dependency/cache dirs, and editor/OS noise. We do
// NOT hide build-output dirs (dist/build/out) or shared editor config (.vscode):
// many repos legitimately track those as real, browsable source, and hiding them
// unconditionally makes their files invisible with no explanation.
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.idea',
  '.DS_Store',
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

function toRepoRel(repoRoot: string, abs: string): string {
  const rel = path.relative(repoRoot, abs);
  return rel.split(path.sep).join('/');
}

// Lexical containment guard. Resolves `rel` against the repo root and rejects
// paths that escape it textually. This does NOT account for symlinks; callers
// that read files must additionally verify the realpath is contained
// (see resolveContained).
function safeJoin(repoRoot: string, rel: string): string {
  const normalized = path.normalize(rel).replace(/^([/\\])+/, '');
  const joined = path.join(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  const target = path.resolve(joined);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path escapes repository: ${rel}`);
  }
  return target;
}

// Resolves the real (symlink-followed) path of `abs` and verifies it still lives
// inside the repository root's real path. This closes the symlink-escape hole: a
// committed symlink such as `creds -> /Users/me/.ssh/id_ed25519` passes the
// lexical safeJoin check but its realpath points outside the repo, so reads of it
// are refused. Returns the real, contained absolute path.
async function resolveContained(repoRoot: string, abs: string): Promise<string> {
  const realRoot = await fs.realpath(path.resolve(repoRoot));
  const realTarget = await fs.realpath(abs);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new Error(`Path escapes repository: ${toRepoRel(repoRoot, abs)}`);
  }
  return realTarget;
}

export async function listTree(repoRoot: string, relDir: string = ''): Promise<TreeEntry[]> {
  const absDir = relDir ? safeJoin(repoRoot, relDir) : path.resolve(repoRoot);
  const dirents = await fs.readdir(absDir, { withFileTypes: true });
  const entries: TreeEntry[] = [];
  for (const d of dirents) {
    if (SKIP_DIRS.has(d.name)) continue;
    const absPath = path.join(absDir, d.name);
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    if (!isDir && !isFile) {
      if (!d.isSymbolicLink()) continue; // skip sockets/fifos/etc.
      // Surface committed symlinks (common in monorepos / dotfiles / pnpm) instead
      // of silently dropping them. Classify by the target, but only if it resolves
      // to something still inside the repo — otherwise treat it as a leaf file so
      // it stays visible without offering to traverse outside the root.
      try {
        const real = await resolveContained(repoRoot, absPath);
        const targetStat = await fs.stat(real);
        isDir = targetStat.isDirectory();
        isFile = targetStat.isFile();
        if (!isDir && !isFile) continue;
      } catch {
        // Broken link or one pointing outside the repo: show as a (non-openable)
        // file entry so it is not invisible, but never as a traversable dir.
        isDir = false;
        isFile = true;
      }
    }
    entries.push({
      name: d.name,
      path: toRepoRel(repoRoot, absPath),
      kind: isDir ? 'dir' : 'file',
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export async function readFile(repoRoot: string, relPath: string): Promise<FileContent> {
  const abs = safeJoin(repoRoot, relPath);
  // Resolve symlinks and re-verify containment before reading. Without this, a
  // committed symlink pointing outside the repo (e.g. to ~/.ssh) would pass the
  // lexical safeJoin guard and exfiltrate the target's contents to the renderer.
  const real = await resolveContained(repoRoot, abs);
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error(`Not a file: ${relPath}`);
  const size = stat.size;
  if (size > MAX_FILE_BYTES) {
    const fd = await fs.open(real, 'r');
    try {
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      // A single read may return fewer bytes than requested (short reads, network
      // FS, or the file shrinking after stat). Loop until the buffer is filled or
      // EOF, and only ever look at the bytes actually read so the buffer's
      // zero-filled tail can't be misread as NULs (binary misclassification) or
      // appended as U+0000 garbage to the text.
      let total = 0;
      while (total < MAX_FILE_BYTES) {
        const { bytesRead } = await fd.read(buf, total, MAX_FILE_BYTES - total, total);
        if (bytesRead === 0) break; // EOF
        total += bytesRead;
      }
      const slice = buf.subarray(0, total);
      const binary = looksBinary(slice);
      return {
        path: relPath,
        text: binary ? null : slice.toString('utf8'),
        isBinary: binary,
        size,
        truncated: true,
      };
    } finally {
      await fd.close();
    }
  }
  const buf = await fs.readFile(real);
  const binary = looksBinary(buf);
  return {
    path: relPath,
    text: binary ? null : buf.toString('utf8'),
    isBinary: binary,
    size,
    truncated: false,
  };
}
