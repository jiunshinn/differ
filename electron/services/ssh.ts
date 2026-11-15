import { spawn } from 'node:child_process';
import type { Environment } from '../../shared/types';

/**
 * Talking to another machine over SSH.
 *
 * Repositories can live on a remote environment, so git and file access have to
 * run there rather than on this Mac. Everything goes through the user's own ssh
 * setup (keys, ~/.ssh/config); we never prompt for a password.
 */

export const sshBinary = (): string => process.env.DIFFER_SSH_BIN || 'ssh';

/** Quote a value for a POSIX shell (the local shell or the remote one). */
export const shq = (value: string): string => `'${String(value).replace(/'/g, `'\\''`)}'`;

export function sshArgs(env: Environment, remoteCommand: string): string[] {
  return [
    '-T',
    '-p',
    String(env.port || 22),
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    env.host,
    remoteCommand,
  ];
}

/** A remote machine we can run commands on. */
export interface SshTarget {
  env: Environment;
  host: string;
  port: number;
}

/** The ssh target for an environment, or null when it is this machine. */
export function sshTarget(env: Environment): SshTarget | null {
  return env.kind === 'ssh' ? { env, host: env.host, port: env.port || 22 } : null;
}

export interface SshResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run a command on the remote machine and collect its output. */
export function runSsh(
  target: SshTarget,
  command: string,
  opts: { input?: string | Buffer; timeoutMs?: number } = {},
): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(sshBinary(), sshArgs(target.env, command), {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    if (opts.timeoutMs) {
      timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
    }
    if (opts.input != null) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/** Run a throwaway Node script on the remote machine and parse its JSON output. */
export async function runRemoteNode<T>(
  target: SshTarget,
  script: string,
  args: string[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const command = `node -e ${shq(script)} ${args.map(shq).join(' ')}`.trim();
  const result = await runSsh(target, command, { timeoutMs: opts.timeoutMs ?? 20_000 });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `ssh exited with code ${result.code}`;
    throw new Error(detail);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`Unexpected response from ${target.env.name}: ${result.stdout.slice(0, 200)}`);
  }
}
