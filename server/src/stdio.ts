import { createInterface } from 'node:readline';
import type { ServerMessage } from '../../shared/protocol.js';
import type { Hub } from './hub.js';
import { createPeer, dispatch, removePeer } from './rpc.js';

/**
 * Serves the protocol over stdin/stdout, one JSON message per line.
 * Used when the server runs behind `ssh host command`, where the SSH channel
 * is the transport and nothing listens on a network port remotely.
 */
export function startStdio(hub: Hub): { close(): void } {
  const write = (msg: ServerMessage) => {
    // stdout is the protocol; anything else must go to stderr.
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  };
  const peer = createPeer(hub, write);
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (line.trim()) void dispatch(hub, peer, line);
  });
  rl.on('close', () => {
    removePeer(hub, peer);
    process.exit(0);
  });
  // Keep the process alive while stdin is open.
  process.stdin.resume();
  return {
    close: () => {
      removePeer(hub, peer);
      rl.close();
    },
  };
}
