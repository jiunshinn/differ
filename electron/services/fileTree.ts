import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileContent, TreeEntry } from '../../shared/types';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.idea',
  '.vscode',
  '.DS_Store',
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

function toRepoRel(repoRoot: string, abs: string): string {
  const rel = path.relative(repoRoot, abs);
  return rel.split(path.sep).join('/');
}

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

export async function listTree(repoRoot: string, relDir: string = ''): Promise<TreeEntry[]> {
  const absDir = relDir ? safeJoin(repoRoot, relDir) : path.resolve(repoRoot);
  const dirents = await fs.readdir(absDir, { withFileTypes: true });
  const entries: TreeEntry[] = [];
  for (const d of dirents) {
    if (SKIP_DIRS.has(d.name)) continue;
    const absPath = path.join(absDir, d.name);
    const isDir = d.isDirectory();
    const isFile = d.isFile();
    if (!isDir && !isFile) continue; // skip symlinks/sockets
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
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error(`Not a file: ${relPath}`);
  const size = stat.size;
  if (size > MAX_FILE_BYTES) {
    const fd = await fs.open(abs, 'r');
    try {
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      await fd.read(buf, 0, MAX_FILE_BYTES, 0);
      const binary = looksBinary(buf);
      return {
        path: relPath,
        text: binary ? null : buf.toString('utf8'),
        isBinary: binary,
        size,
        truncated: true,
      };
    } finally {
      await fd.close();
    }
  }
  const buf = await fs.readFile(abs);
  const binary = looksBinary(buf);
  return {
    path: relPath,
    text: binary ? null : buf.toString('utf8'),
    isBinary: binary,
    size,
    truncated: false,
  };
}
