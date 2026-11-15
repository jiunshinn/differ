import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import type { ServerMessage } from '../../shared/protocol.js';
import type { Hub } from './hub.js';
import { createPeer, dispatch, removePeer } from './rpc.js';

function tokenOk(req: IncomingMessage, token: string): boolean {
  const given = new URL(req.url ?? '/', 'http://x').searchParams.get('token') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Serves the protocol over a WebSocket bound to a local address. */
export function startWebSocket(hub: Hub, opts: { host: string; port: number; token: string }): Promise<{ url: string; close(): void }> {
  const wss = new WebSocketServer({
    host: opts.host,
    port: opts.port,
    maxPayload: 16 * 1024 * 1024,
    verifyClient: ({ req }: { req: IncomingMessage }) => tokenOk(req, opts.token),
  });

  wss.on('connection', (ws) => {
    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const peer = createPeer(hub, send);
    ws.on('close', () => removePeer(hub, peer));
    ws.on('message', (data) => void dispatch(hub, peer, String(data)));
  });

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const addr = wss.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({ url: `ws://${opts.host}:${port}`, close: () => wss.close() });
    });
  });
}
