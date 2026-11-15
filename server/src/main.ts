/**
 * differ server entry point.
 *
 * Transports:
 *   (default)        WebSocket on DIFFER_HOST:DIFFER_PORT, prints one ready line to stdout:
 *                    DIFFER_READY {"url":"ws://127.0.0.1:PORT","token":"..."}
 *   --stdio          JSON lines over stdin/stdout. Used over SSH, where the channel is
 *                    the transport and nothing listens on a network port.
 *
 * Environment:
 *   DIFFER_DATA_DIR   where threads, server.sqlite3 and agents.json live (default ~/.differ)
 *   DIFFER_HOST       bind address, WebSocket mode (default 127.0.0.1)
 *   DIFFER_PORT       port, WebSocket mode (default 0 = any free port)
 *   DIFFER_TOKEN      required auth token for clients (default: random)
 *   DIFFER_AGENTS     extra provider specs as a JSON array
 *
 * When stdin closes (the parent app or SSH session ended), the server shuts down.
 */
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ServerEndpoint } from '../../shared/protocol.js';
import { Hub } from './hub.js';
import { ModelPrefs } from './modelPrefs.js';
import { Providers } from './providers.js';
import { startStdio } from './stdio.js';
import { Store } from './store.js';
import { startWebSocket } from './ws.js';

async function main() {
  const stdio = process.argv.includes('--stdio') || process.env.DIFFER_STDIO === '1';
  const dataDir = process.env.DIFFER_DATA_DIR || path.join(os.homedir(), '.differ');

  const store = new Store(dataDir);
  const hub = new Hub(store, new Providers(dataDir), new ModelPrefs(dataDir));

  let transport: { close(): void };
  if (stdio) {
    transport = startStdio(hub);
    // The desktop app waits for this before handing the bridge to the renderer,
    // so an unreachable machine can't look "connected" while ssh is still failing.
    process.stderr.write('DIFFER_STDIO_READY\n');
  } else {
    const token = process.env.DIFFER_TOKEN || randomBytes(24).toString('base64url');
    const ws = await startWebSocket(hub, { host: process.env.DIFFER_HOST || '127.0.0.1', port: Number(process.env.DIFFER_PORT || 0), token });
    transport = ws;
    const endpoint: ServerEndpoint = { url: ws.url, token };
    process.stdout.write(`DIFFER_READY ${JSON.stringify(endpoint)}\n`);
  }

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    hub.dispose();
    transport.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  if (!stdio) {
    process.stdin.on('end', stop);
    process.stdin.on('close', stop);
    process.stdin.resume();
  }
}

main().catch((err) => {
  console.error('[differ] server failed to start:', err);
  process.exit(1);
});
