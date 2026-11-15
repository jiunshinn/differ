import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileContent, TreeEntry } from '../../shared/types';
import { sshFor } from './git';
import { runRemoteNode } from './ssh';

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
  const remote = sshFor(repoRoot);
  if (remote) return listTreeRemote(repoRoot, relDir);
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

const REMOTE_LIST_SCRIPT = `
const fs = require('fs');
const path = require('path');
const root = process.argv[1];
const rel = process.argv[2] || '';
const dir = rel ? path.join(root, rel) : root;
const out = [];
for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  if (entry.isDirectory()) out.push({ name: entry.name, kind: 'dir' });
  else if (entry.isFile()) out.push({ name: entry.name, kind: 'file' });
}
process.stdout.write(JSON.stringify(out));
`;

const REMOTE_READ_SCRIPT = `
const fs = require('fs');
const path = require('path');
const root = process.argv[1];
const rel = process.argv[2];
const max = Number(process.argv[3]);
const abs = path.join(root, rel);
const stat = fs.statSync(abs);
const size = stat.size;
const read = Math.min(size, max);
const fd = fs.openSync(abs, 'r');
const buf = Buffer.alloc(read);
fs.readSync(fd, buf, 0, read, 0);
fs.closeSync(fd);
process.stdout.write(JSON.stringify({ size, base64: buf.toString('base64') }));
`;

/** Directory listing for a working copy on a remote environment. */
async function listTreeRemote(repoRoot: string, relDir: string): Promise<TreeEntry[]> {
  const remote = sshFor(repoRoot);
  if (!remote) return [];
  const raw = await runRemoteNode<{ name: string; kind: 'dir' | 'file' }[]>(remote, REMOTE_LIST_SCRIPT, [
    repoRoot,
    relDir,
  ]);
  const prefix = relDir ? `${relDir.replace(/\/+$/, '')}/` : '';
  const entries: TreeEntry[] = raw
    .filter((e) => !SKIP_DIRS.has(e.name))
    .map((e) => ({ name: e.name, path: `${prefix}${e.name}`, kind: e.kind }));
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

async function readFileRemote(repoRoot: string, relPath: string): Promise<FileContent> {
  const remote = sshFor(repoRoot);
  if (!remote) throw new Error(`Not a remote repository: ${repoRoot}`);
  const result = await runRemoteNode<{ size: number; base64: string }>(remote, REMOTE_READ_SCRIPT, [
    repoRoot,
    relPath,
    String(MAX_FILE_BYTES),
  ]);
  const buf = Buffer.from(result.base64, 'base64');
  const binary = looksBinary(buf);
  return {
    path: relPath,
    text: binary ? null : buf.toString('utf8'),
    isBinary: binary,
    size: result.size,
    truncated: result.size > MAX_FILE_BYTES,
  };
}

export async function readFile(repoRoot: string, relPath: string): Promise<FileContent> {
  if (sshFor(repoRoot)) return readFileRemote(repoRoot, relPath);
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
