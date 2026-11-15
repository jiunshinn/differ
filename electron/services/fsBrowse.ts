import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FsBrowseEntry, FsBrowseListing } from '../../shared/types';
import { getEnvironment } from '../environments';
import { runRemoteNode, sshTarget, type SshTarget } from './ssh';

/**
 * Folder navigation for the "Add project" dialog.
 *
 * Lists directories on the machine the project will come from: this Mac, or an
 * SSH environment. Hidden folders are skipped by default so the listing stays
 * about projects; the dialog's path field is the escape hatch for anything else.
 */

const REMOTE_LIST_SCRIPT = `
const fs = require('fs');
const path = require('path');
const os = require('os');
const raw = process.argv[1];
const home = os.homedir();
let dir = raw;
if (dir === '~' || dir.startsWith('~/')) dir = path.join(home, dir.slice(1));
dir = path.resolve(dir);
const stat = fs.statSync(dir);
if (!stat.isDirectory()) throw new Error('Not a folder: ' + dir);
const parent = path.dirname(dir) === dir ? null : path.dirname(dir);
const entries = [];
for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (entry.name.startsWith('.')) continue;
  const full = path.join(dir, entry.name);
  let isRepo = false;
  try { isRepo = fs.existsSync(path.join(full, '.git')); } catch (e) { isRepo = false; }
  entries.push({ name: entry.name, path: full, isRepo });
}
entries.sort((a, b) => a.name.localeCompare(b.name));
let isRepo = false;
try { isRepo = fs.existsSync(path.join(dir, '.git')); } catch (e) { isRepo = false; }
process.stdout.write(JSON.stringify({ path: dir, parent, home, isRepo, entries }));
`;

/** Expand ~ and make a user-typed path absolute. */
function resolveLocal(rawPath: string, home: string): string {
  const trimmed = rawPath.trim() || home;
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/')) return path.join(home, trimmed.slice(2));
  return path.resolve(trimmed);
}

function listLocal(rawPath: string | null): FsBrowseListing {
  const home = os.homedir();
  const dir = resolveLocal(rawPath ?? home, home);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new Error(`Folder not found: ${dir}`);
  }
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${dir}`);

  const entries: FsBrowseEntry[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    // Symlinked folders are common (e.g. ~/dev -> an external volume), so follow them.
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = fs.statSync(full).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    if (!isDirectory) continue;
    let isRepo = false;
    try {
      isRepo = fs.existsSync(path.join(full, '.git'));
    } catch {
      isRepo = false;
    }
    entries.push({ name: entry.name, path: full, isRepo });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const parent = path.dirname(dir);
  let isRepo = false;
  try {
    isRepo = fs.existsSync(path.join(dir, '.git'));
  } catch {
    isRepo = false;
  }
  return { path: dir, parent: parent === dir ? null : parent, home, isRepo, entries };
}

async function listRemote(target: SshTarget, rawPath: string | null): Promise<FsBrowseListing> {
  return runRemoteNode<FsBrowseListing>(target, REMOTE_LIST_SCRIPT, [rawPath ?? '~']);
}

/** List the folders inside `dirPath` on `environmentId` ('local' = this Mac). */
export async function listDirectory(
  environmentId: string | null,
  dirPath: string | null,
): Promise<FsBrowseListing> {
  const remoteId = environmentId && environmentId !== 'local' ? environmentId : null;
  const env = remoteId ? getEnvironment(remoteId) : undefined;
  // Never fall back to listing this Mac when the requested machine is gone.
  if (remoteId && !env) throw new Error(`This machine is no longer configured (${remoteId})`);
  const target = env ? sshTarget(env) : null;
  if (target) return listRemote(target, dirPath);
  return listLocal(dirPath);
}
