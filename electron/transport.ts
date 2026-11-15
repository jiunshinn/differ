import { app } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { Environment, ServerEndpoint } from '../shared/types';
import { activeEnvironment, getEnvironment } from './environments';
import { sshArgs } from './services/ssh';

/**
 * Owns the connections to the differ servers, one per environment.
 *
 * Several machines can be connected at the same time: this Mac and any number of
 * SSH environments. Each has its own server process (or ssh + remote node), its
 * own port, and its own set of threads, so agents can run on all of them at once.
 *
 * Local:  node server/dist/server/src/main.js          (WebSocket directly)
 * Remote: ssh host node ~/.differ/server/... --stdio    (our protocol over the SSH pipe)
 *
 * Either way the renderer gets a ws:// endpoint: for SSH, a small local WebSocket
 * bridge forwards frames to the SSH channel, so the app code is identical.
 */
export const localServerEntry = () => path.resolve(__dirname, '..', '..', 'server', 'dist', 'server', 'src', 'main.js');

interface EnvConnection {
  env: Environment;
  child: ChildProcess | null;
  bridge: WebSocketServer | null;
  endpoint: Promise<ServerEndpoint> | null;
}

const connections = new Map<string, EnvConnection>();

/** Expand a leading ~ — a quoted tilde never expands in the remote shell, so swap in $HOME. */
function remoteDirPath(env: Environment): string {
  const dir = (env.remoteDir || '~/.differ/server').replace(/^~(?=\/|$)/, '$HOME');
  return `"${dir}"`;
}

function remoteStartCommand(env: Environment): string {
  if (env.command.trim()) return env.command.trim();
  // The bundle installs the server at <remoteDir>/dist/server; node resolves its
  // dependencies (ws, zod, the ACP sdk) walking up from there. The server prints
  // protocol JSON lines on stdout.
  return `cd ${remoteDirPath(env)}/dist/server && exec node src/main.js --stdio`;
}

function localEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', DIFFER_DATA_DIR: path.join(app.getPath('userData'), 'server'), DIFFER_HOST: '127.0.0.1' };
}

/** Spawn the server process for an environment (local node, or ssh + remote node). */
function spawnServer(env: Environment): ChildProcess {
  if (env.kind === 'local') {
    return spawn(process.execPath, [localServerEntry()], { env: localEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  }
  const ssh = process.env.DIFFER_SSH_BIN || 'ssh';
  return spawn(ssh, sshArgs(env, remoteStartCommand(env)), { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
}

async function startBridge(conn: EnvConnection): Promise<ServerEndpoint> {
  const { env } = conn;
  const proc = spawnServer(env);
  conn.child = proc;
  let stderr = '';
  // Remote servers announce themselves on stderr once the hub is up. Waiting for
  // this keeps a failing ssh from looking like a live connection.
  let remoteReady = false;
  let markRemoteReady: (() => void) | null = null;
  let failRemoteReady: ((err: Error) => void) | null = null;
  proc.stderr!.setEncoding('utf8');
  proc.stderr!.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
    process.stderr.write(`[server:${env.name}] ${chunk}`);
    if (!remoteReady && chunk.includes('DIFFER_STDIO_READY')) {
      remoteReady = true;
      markRemoteReady?.();
    }
  });

  if (env.kind === 'local') {
    // The local server already speaks WebSocket; hand its endpoint to the renderer.
    return new Promise<ServerEndpoint>((resolve, reject) => {
      let out = '';
      let ready = false;
      proc.stdout!.setEncoding('utf8');
      proc.stdout!.on('data', (chunk: string) => {
        if (ready) return;
        out += chunk;
        const m = out.match(/DIFFER_READY (.+)\n/);
        if (m) {
          ready = true;
          resolve(JSON.parse(m[1]) as ServerEndpoint);
        }
      });
      proc.once('error', reject);
      proc.once('exit', (code, signal) => {
        conn.child = null;
        // Do not evict a newer connection that replaced this one.
        if (connections.get(env.id) === conn) connections.delete(env.id);
        if (!ready) {
          const why = stderr.trim() ? `\n${stderr.trim()}` : '';
          reject(new Error(`differ server exited before it was ready (code ${code}, signal ${signal}).${why}`));
        }
      });
    });
  }

  // Remote: stdio over SSH, bridged to a local WebSocket.
  const token = randomBytes(24).toString('base64url');
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  conn.bridge = wss;
  const clients = new Set<{ send(data: string): void }>();
  const ready = new Promise<void>((resolve, reject) => {
    markRemoteReady = resolve;
    failRemoteReady = reject;
  });
  // The timeout below may win this race; a late ssh failure must not go unhandled.
  ready.catch(() => undefined);

  let buf = '';
  proc.stdout!.setEncoding('utf8');
  proc.stdout!.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      // Relay protocol lines to every connected client.
      if (line.trim()) for (const c of clients) c.send(line);
    }
  });

  wss.on('connection', (ws, req) => {
    const given = new URL(req.url ?? '/', 'http://x').searchParams.get('token');
    if (given !== token) {
      ws.close();
      return;
    }
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (data) => {
      // One JSON message per line on the SSH side.
      proc.stdin!.write(`${String(data)}\n`);
    });
  });

  proc.once('error', (err) => {
    for (const c of clients) c.send(JSON.stringify({ type: 'res', id: -1, ok: false, error: { message: String(err) } }));
  });
  proc.once('exit', (code, signal) => {
    conn.child = null;
    conn.bridge = null;
    conn.endpoint = null;
    if (connections.get(env.id) === conn) connections.delete(env.id);
    if (!remoteReady) {
      failRemoteReady?.(new Error(stderr.trim() || `ssh exited with code ${code}`));
      return;
    }
    const why = stderr.trim() ? `\n${stderr.trim()}` : '';
    console.error(`[differ] ${env.name} connection closed (code ${code}, signal ${signal})${why}`);
    for (const c of clients) c.send(JSON.stringify({ type: 'res', id: -1, ok: false, error: { message: `Connection to ${env.name} closed${why}` } }));
    for (const c of clients) (c as unknown as { close(): void }).close();
  });

  await new Promise<void>((resolve, reject) => {
    // If ssh dies before the bridge is listening, fail with its message instead of hanging.
    const onExit = (code: number | null) => reject(new Error(stderr.trim() || `ssh exited with code ${code}`));
    proc.once('exit', onExit);
    wss.once('listening', () => {
      proc.off('exit', onExit);
      resolve();
    });
    wss.once('error', reject);
  });
  // Old remote builds never print the marker, so give them a moment and move on.
  await Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
  const addr = wss.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `ws://127.0.0.1:${port}`, token };
}

function resolveEnvironment(envId?: string | null): Environment {
  if (envId) {
    const env = getEnvironment(envId);
    if (!env) throw new Error(`No such environment: ${envId}`);
    return env;
  }
  return activeEnvironment();
}

/** Turn terse ssh failures into something the user can act on. */
function explainConnectError(detail: string, env: Environment): string {
  const message = detail.trim();
  if (!message) return `Could not connect to ${env.name}.`;
  if (/connection refused/i.test(message)) {
    return `${message}\nCheck the host: it should be a machine name or user@host (for example jiun@thinkpad), and sshd has to be running there.`;
  }
  if (/could not resolve hostname/i.test(message)) {
    return `${message}\nThat host name doesn't resolve from this Mac.`;
  }
  if (/permission denied/i.test(message)) {
    return `${message}\ndiffer uses your ssh keys without asking for a password. Copy one over with: ssh-copy-id ${env.host}`;
  }
  return message;
}

/** Start (or reuse) the connection for one environment. */
export function connectEnvironment(envId?: string | null): Promise<ServerEndpoint> {
  const env = resolveEnvironment(envId);
  const existing = connections.get(env.id);
  if (existing?.endpoint) return existing.endpoint;

  const conn: EnvConnection = { env, child: null, bridge: null, endpoint: null };
  connections.set(env.id, conn);
  conn.endpoint = startBridge(conn).catch((err) => {
    // Leave nothing behind so the next attempt starts a fresh ssh/server.
    if (conn.child) {
      conn.child.stdin?.end();
      conn.child.kill('SIGTERM');
      conn.child = null;
    }
    try {
      conn.bridge?.close();
    } catch {
      /* already closed */
    }
    conn.bridge = null;
    conn.endpoint = null;
    connections.delete(env.id);
    throw new Error(explainConnectError(err instanceof Error ? err.message : String(err), env));
  });
  return conn.endpoint;
}

/** Tear down one environment's connection (or every environment when omitted). */
export function disconnectEnvironment(envId?: string | null): void {
  if (!envId) {
    for (const id of [...connections.keys()]) disconnectEnvironment(id);
    return;
  }
  const conn = connections.get(envId);
  if (!conn) return;
  connections.delete(envId);
  conn.endpoint = null;
  try {
    conn.bridge?.close();
  } catch {
    /* already closed */
  }
  conn.bridge = null;
  if (conn.child) {
    conn.child.stdin?.end();
    conn.child.kill('SIGTERM');
    conn.child = null;
  }
}

/** Environment ids with a live connection (for the settings screen). */
export function connectedEnvironmentIds(): string[] {
  return [...connections.keys()];
}

// ─── Environment helpers ────────────────────────────────────────────────────

export interface EnvCheck {
  ok: boolean;
  detail: string;
}

/** Run a command on the environment and collect its output (for "Test connection"). */
export function runRemote(env: Environment, command: string, timeoutMs = 15_000): EnvCheck {
  if (env.kind === 'local') {
    const res = spawnSync(process.execPath, ['-e', 'console.log(process.version)'], { env: localEnv(), encoding: 'utf8', timeout: timeoutMs });
    return { ok: res.status === 0, detail: (res.stdout || res.stderr || '').trim() };
  }
  const ssh = process.env.DIFFER_SSH_BIN || 'ssh';
  const res = spawnSync(ssh, [...sshArgs(env, command)], { encoding: 'utf8', timeout: timeoutMs });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  return { ok: res.status === 0, detail: out };
}

/** Node version on the environment; the server needs 22.5+ for node:sqlite. */
export function checkNode(env: Environment): EnvCheck {
  const res = runRemote(env, 'node --version');
  if (!res.ok) return { ok: false, detail: res.detail || 'node not found on the remote machine' };
  const m = res.detail.match(/v(\d+)\.(\d+)/);
  const major = m ? Number(m[1]) : 0;
  const minor = m ? Number(m[2]) : 0;
  const ok = major > 22 || (major === 22 && minor >= 5);
  return {
    ok,
    detail: ok ? `${res.detail.trim()} (Node ${major}.${minor})` : `${res.detail.trim()} is too old; differ needs Node 22.5 or newer`,
  };
}

/**
 * Copy the server bundle to the remote machine and install its dependencies.
 * The bundle is this repo's server/dist plus a package.json generated from our
 * installed versions (the server has no native dependencies).
 */
export function bootstrapEnvironment(env: Environment): EnvCheck {
  if (env.kind === 'local') return { ok: true, detail: 'Nothing to install for this machine.' };
  const repoRoot = path.resolve(__dirname, '..', '..');
  const serverDist = path.join(repoRoot, 'server', 'dist', 'server');
  if (!fs.existsSync(serverDist)) return { ok: false, detail: 'Build the server first: npm run build:server' };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'differ-boot-'));
  try {
    fs.cpSync(serverDist, path.join(tmp, 'dist', 'server'), { recursive: true });
    // The build also emits shared/protocol.js next to server/ (rootDir is the repo
    // root), and the compiled server imports it — the bundle needs both trees.
    fs.cpSync(path.join(repoRoot, 'server', 'dist', 'shared'), path.join(tmp, 'dist', 'shared'), { recursive: true });
    const pkg = {
      name: 'differ-server-remote',
      private: true,
      type: 'module',
      dependencies: {
        '@agentclientprotocol/sdk': dependencyVersion('@agentclientprotocol/sdk'),
        '@agentclientprotocol/claude-agent-acp': dependencyVersion('@agentclientprotocol/claude-agent-acp'),
        zod: dependencyVersion('zod'),
        ws: dependencyVersion('ws'),
      },
    };
    fs.writeFileSync(path.join(tmp, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

    const tar = spawnSync('tar', ['-czf', path.join(tmp, 'bundle.tgz'), '-C', tmp, 'dist', 'package.json'], { encoding: 'utf8' });
    if (tar.status !== 0) return { ok: false, detail: `tar failed: ${tar.stderr}` };

    const scp = process.env.DIFFER_SCP_BIN || 'scp';
    const copy = spawnSync(scp, ['-P', String(env.port || 22), '-o', 'BatchMode=yes', path.join(tmp, 'bundle.tgz'), `${env.host}:/tmp/differ-bundle.tgz`], { encoding: 'utf8' });
    if (copy.status !== 0) return { ok: false, detail: `scp failed: ${(copy.stderr || copy.stdout || '').trim()}` };

    const target = remoteDirPath(env);
    const install = `mkdir -p ${target} && tar -xzf /tmp/differ-bundle.tgz -C ${target} && cd ${target} && npm install --omit=dev --no-audit --no-fund && rm -f /tmp/differ-bundle.tgz`;
    return runRemote(env, install, 300_000);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Version of an installed dependency, for the remote package.json. */
function dependencyVersion(name: string): string {
  try {
    // Read node_modules directly: require.resolve('<pkg>/package.json') is
    // blocked by the exports map of current packages and silently degrades to '*'.
    const pkgPath = path.join(path.resolve(__dirname, '..', '..'), 'node_modules', name, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    if (!pkg.version) return '*';
    // Pin the exact version: the server bundle was compiled against these APIs.
    return pkg.version;
  } catch {
    return '*';
  }
}
