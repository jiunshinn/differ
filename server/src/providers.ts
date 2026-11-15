import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ProviderInfo, ProviderSpec } from '../../shared/protocol.js';

const require = createRequire(import.meta.url);

/** A spec plus where it came from. */
interface Entry extends ProviderSpec {
  source: ProviderInfo['source'];
}

export class ProviderError extends Error {}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function bundledBin(pkg: string, bin: string): string | null {
  try {
    const pkgJson = require.resolve(`${pkg}/package.json`);
    const meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { bin?: Record<string, string> };
    const rel = meta.bin?.[bin];
    return rel ? path.join(path.dirname(pkgJson), rel) : null;
  } catch {
    return null;
  }
}

function builtIns(): ProviderSpec[] {
  const specs: ProviderSpec[] = [];
  const claude = bundledBin('@agentclientprotocol/claude-agent-acp', 'claude-agent-acp');
  if (claude) {
    specs.push({
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Anthropic’s coding agent through the bundled ACP adapter. Uses your Claude Code login.',
      // Run the adapter with the same Node as the server (Electron's when local).
      command: process.execPath,
      args: [claude],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  }
  return specs;
}

/**
 * Places a CLI can live that a GUI app doesn't see in $PATH. Electron started
 * from Finder/Dock gets a minimal PATH, so `~/.local/bin/cursor-agent` would
 * otherwise look missing.
 */
function extraDirs(): string[] {
  // Explicit override, handy on remote hosts or when a CLI lives somewhere unusual.
  if (process.env.DIFFER_AGENT_DIRS) return process.env.DIFFER_AGENT_DIRS.split(path.delimiter).filter((d) => d.length > 0);
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const dirs: string[] = [];
  if (home) {
    dirs.push(
      path.join(home, '.local', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.cargo', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.asdf', 'shims'),
      // OpenCode's installer drops the binary here.
      path.join(home, '.opencode', 'bin'),
    );
  }
  if (process.platform !== 'win32') dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
  return dirs;
}

function searchDirs(): string[] {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...extraDirs()];
  return [...new Set(dirs.filter((d) => d.length > 0))];
}

function exts(): string[] {
  return process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
}

/** Absolute path for a runnable command, resolving PATH plus well-known dirs. */
export function resolveCommand(command: string): string | null {
  if (!command) return null;
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : null;
  for (const dir of searchDirs()) {
    for (const ext of exts()) {
      const full = path.join(dir, command + ext);
      try {
        if (!fs.statSync(full).isFile()) continue;
        if (process.platform !== 'win32') fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // not here, or not executable
      }
    }
  }
  return null;
}

/**
 * ACP agents differ in how they're started: some speak ACP natively behind a
 * flag (`gemini --acp`), others through a subcommand (`opencode acp`) or a
 * bundled adapter (`codex-acp`). There's no discovery mechanism in the
 * protocol, so this is the table that makes "already installed" mean something.
 */
const DETECTABLE: Array<{ id: string; name: string; description: string; commands: Array<{ command: string; args: string[] }> }> = [
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex through the codex-acp adapter. Uses your ChatGPT login or CODEX_API_KEY.',
    commands: [{ command: 'codex-acp', args: [] }],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'Cursor’s CLI agent. Sign in with `cursor-agent login` or set CURSOR_API_KEY.',
    commands: [
      { command: 'cursor-agent', args: ['acp'] },
      { command: 'agent', args: ['acp'] },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode in ACP mode. Uses the providers and rules you already configured in OpenCode.',
    commands: [{ command: 'opencode', args: ['acp'] }],
  },
  {
    id: 'devin',
    name: 'Devin',
    description: 'Cognition’s Devin CLI. Sign in with the Devin CLI before starting a thread.',
    commands: [{ command: 'devin', args: ['acp'] }],
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'Google’s Gemini CLI in ACP mode. Uses your Google login or GEMINI_API_KEY.',
    commands: [{ command: 'gemini', args: ['--acp'] }],
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot',
    description: 'GitHub Copilot CLI in ACP mode. Uses your GitHub login.',
    commands: [{ command: 'copilot', args: ['--acp'] }],
  },
  {
    id: 'goose',
    name: 'goose',
    description: 'Block’s open source agent. Configure a model provider in goose first.',
    commands: [{ command: 'goose', args: ['acp'] }],
  },
];

/** Agents from DETECTABLE that are actually installed, as launchable specs. */
export function detectedProviders(): ProviderSpec[] {
  const specs: ProviderSpec[] = [];
  for (const agent of DETECTABLE) {
    const hit = agent.commands.map((c) => ({ ...c, command: resolveCommand(c.command) })).find((c) => c.command !== null);
    if (!hit?.command) continue;
    specs.push({ id: agent.id, name: agent.name, description: agent.description, command: hit.command, args: hit.args });
  }
  return specs;
}

function onPath(command: string): boolean {
  return resolveCommand(command) !== null;
}

function isSpec(v: unknown): v is ProviderSpec {
  const s = v as ProviderSpec;
  return !!s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.command === 'string' && Array.isArray(s.args) && s.args.every((a) => typeof a === 'string');
}

/** Normalise user input into a spec, or explain what's wrong. */
export function validateSpec(input: unknown): ProviderSpec {
  if (!input || typeof input !== 'object') throw new ProviderError('Provider must be an object');
  const p = input as Partial<ProviderSpec>;
  const id = String(p.id ?? '').trim().toLowerCase();
  const name = String(p.name ?? '').trim();
  const command = String(p.command ?? '').trim();
  if (!ID_RE.test(id)) throw new ProviderError('The id must use lowercase letters, numbers and dashes, e.g. "my-agent"');
  if (!name) throw new ProviderError('Give the provider a name');
  if (!command) throw new ProviderError('The command to start the agent is required');
  const args = (p.args ?? []).map((a) => String(a)).filter((a) => a.length > 0);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.env ?? {})) {
    const key = k.trim();
    if (key) env[key] = String(v);
  }
  return {
    id,
    name,
    command,
    args,
    ...(p.description?.trim() ? { description: p.description.trim() } : {}),
    ...(Object.keys(env).length ? { env } : {}),
  };
}

/**
 * The provider catalogue: built in, plus anything in <dataDir>/agents.json (editable
 * from the app) and DIFFER_AGENTS (read-only, used by tests).
 */
export class Providers {
  private entries: Entry[] = [];

  constructor(private dataDir: string) {
    this.reload();
  }

  private get file() {
    return path.join(this.dataDir, 'agents.json');
  }

  private readFile(): ProviderSpec[] {
    if (!fs.existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(raw)) throw new Error('expected an array');
      return raw.filter(isSpec);
    } catch (err) {
      console.error(`[differ] ignoring invalid ${this.file}:`, err);
      return [];
    }
  }

  private readEnv(): ProviderSpec[] {
    if (!process.env.DIFFER_AGENTS) return [];
    try {
      const raw = JSON.parse(process.env.DIFFER_AGENTS) as unknown;
      return Array.isArray(raw) ? raw.filter(isSpec) : [];
    } catch {
      return [];
    }
  }

  reload(): void {
    const byId = new Map<string, Entry>();
    for (const s of builtIns()) byId.set(s.id, { ...s, source: 'builtin' });
    // Anything already installed is offered without setup; agents.json can still
    // override a detected entry, and DIFFER_AGENTS overrides everything.
    for (const s of detectedProviders()) byId.set(s.id, { ...s, source: 'detected' });
    for (const s of this.readFile()) byId.set(s.id, { ...s, source: 'file' });
    // Env-defined agents win over the file, so tests can override anything.
    for (const s of this.readEnv()) byId.set(s.id, { ...s, source: 'env' });
    this.entries = [...byId.values()];
  }

  list(): ProviderInfo[] {
    return this.entries.map((e) => ({ ...e, available: onPath(e.command) }));
  }

  /** Spec for launching, including providers from the environment. */
  get(id: string): ProviderSpec | undefined {
    return this.entries.find((e) => e.id === id);
  }

  save(input: unknown): ProviderInfo {
    const spec = validateSpec(input);
    const existing = this.entries.find((e) => e.id === spec.id);
    if (existing?.source === 'env') throw new ProviderError('That provider is set by DIFFER_AGENTS and can’t be edited here');
    if (existing?.source === 'builtin') throw new ProviderError('Claude Code is built in and can’t be edited here');
    const file = this.readFile().filter((p) => p.id !== spec.id);
    file.push(spec);
    this.write(file);
    this.reload();
    return this.list().find((p) => p.id === spec.id)!;
  }

  delete(id: string): void {
    const existing = this.entries.find((e) => e.id === id);
    if (!existing) throw new ProviderError('No such provider');
    if (existing.source === 'detected') {
      throw new ProviderError(`${existing.name} was detected on this machine; remove it from your PATH or add your own provider with a different id`);
    }
    if (existing.source !== 'file') throw new ProviderError(`${existing.name} is built in and can’t be removed`);
    this.write(this.readFile().filter((p) => p.id !== id));
    this.reload();
  }

  private write(specs: ProviderSpec[]): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(specs, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }
}
