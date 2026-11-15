import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectedProviders, resolveCommand } from '../src/providers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'differ-providers-'));
const bin = path.join(tmp, 'bin');
const saved = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DIFFER_AGENT_DIRS: process.env.DIFFER_AGENT_DIRS };

before(() => {
  fs.mkdirSync(bin, { recursive: true });
  // A stand-in CLI that is executable but never actually run by these tests.
  const opencode = path.join(bin, 'opencode');
  fs.writeFileSync(opencode, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // Keep detection hermetic: only the fake bin dir is searched.
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.PATH = bin;
  process.env.DIFFER_AGENT_DIRS = bin;
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('resolveCommand finds a binary on PATH and returns its absolute path', () => {
  assert.equal(resolveCommand('opencode'), path.join(bin, 'opencode'));
  assert.equal(resolveCommand('definitely-not-installed'), null);
});

test('detects installed agents with the right ACP entrypoint', () => {
  const opencode = detectedProviders().find((p) => p.id === 'opencode');
  assert.ok(opencode, 'installed opencode should be detected');
  assert.equal(opencode.command, path.join(bin, 'opencode'));
  assert.deepEqual(opencode.args, ['acp']);
  assert.equal(opencode.name, 'OpenCode');
});

test('skips agents that are not installed', () => {
  const ids = detectedProviders().map((p) => p.id);
  assert.equal(ids.includes('devin'), false);
  assert.equal(ids.includes('codex'), false);
});
