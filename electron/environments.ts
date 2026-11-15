import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Environment, EnvironmentDraft } from '../shared/types';

/**
 * Environments are machines differ can work on: this one, or another reached over SSH.
 * Stored in the app's data folder; the app talks to whichever one is active.
 */
interface Config {
  activeId: string;
  environments: Environment[];
}

const LOCAL_ID = 'local';

const configPath = () => path.join(app.getPath('userData'), 'environments.json');

function localEnvironment(): Environment {
  return {
    id: LOCAL_ID,
    name: 'This Mac',
    kind: 'local',
    host: '',
    port: 22,
    remoteDir: '',
    command: '',
    createdAt: new Date(0).toISOString(),
  };
}

function read(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<Config>;
    const environments = [localEnvironment(), ...(raw.environments ?? []).filter((e) => e && e.kind === 'ssh')];
    const activeId = environments.some((e) => e.id === raw.activeId) ? (raw.activeId as string) : LOCAL_ID;
    return { activeId, environments };
  } catch {
    return { activeId: LOCAL_ID, environments: [localEnvironment()] };
  }
}

function write(cfg: Config): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function listEnvironments(): { activeId: string; environments: Environment[] } {
  const cfg = read();
  return { activeId: cfg.activeId, environments: cfg.environments };
}

export function getEnvironment(id: string): Environment | undefined {
  return read().environments.find((e) => e.id === id);
}

export function activeEnvironment(): Environment {
  const cfg = read();
  return cfg.environments.find((e) => e.id === cfg.activeId) ?? localEnvironment();
}

/** Create or update an SSH environment. Returns the saved entry. */
export function saveEnvironment(input: EnvironmentDraft): Environment {
  const cfg = read();
  const name = input.name.trim();
  const host = input.host.trim();
  if (!name) throw new Error('Give the environment a name');
  if (!host) throw new Error('Enter the host, e.g. devbox or me@10.0.4.12');
  const port = Number(input.port || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  const saved: Environment = {
    id: input.id || `ssh-${randomUUID().slice(0, 8)}`,
    name,
    kind: 'ssh',
    host,
    port,
    remoteDir: input.remoteDir.trim() || '~/.differ/server',
    command: input.command.trim(),
    createdAt: cfg.environments.find((e) => e.id === input.id)?.createdAt ?? new Date().toISOString(),
  };
  cfg.environments = [...cfg.environments.filter((e) => e.id !== saved.id), saved];
  write(cfg);
  return saved;
}

export function deleteEnvironment(id: string): void {
  const cfg = read();
  if (id === LOCAL_ID) throw new Error('This machine can’t be removed');
  cfg.environments = cfg.environments.filter((e) => e.id !== id);
  if (cfg.activeId === id) cfg.activeId = LOCAL_ID;
  write(cfg);
}

/** Switch the app to another environment. The caller restarts the connection. */
export function activateEnvironment(id: string): Environment {
  const cfg = read();
  const env = cfg.environments.find((e) => e.id === id);
  if (!env) throw new Error('No such environment');
  cfg.activeId = id;
  write(cfg);
  return env;
}
