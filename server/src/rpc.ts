import type { ClientMessage, Method, ParamsOf, Push, ServerMessage } from '../../shared/protocol.js';
import { Hub, UserError, type Peer } from './hub.js';
import { ProviderError } from './providers.js';

type Handler = (peer: Peer, params: never) => unknown;

function handlers(hub: Hub): Record<Method, Handler> {
  return {
    hello: () => hub.hello(),
    'threads.list': () => hub.hello().threads,
    'providers.list': () => hub.listProviders(),
    'providers.models': (_p, params: ParamsOf<'providers.models'>) => hub.providerModels(params),
    'models.prefs': () => hub.hiddenModels(),
    'models.savePrefs': (_p, params: ParamsOf<'models.savePrefs'>) => hub.saveHiddenModels(params),
    'providers.save': (_p, params: ParamsOf<'providers.save'>) => hub.saveProvider(params),
    'providers.delete': (_p, params: ParamsOf<'providers.delete'>) => hub.deleteProvider(params.id),
    'thread.create': (_p, params) => hub.createThread(params),
    'thread.subscribe': (peer, params: { threadId: string }) => hub.subscribe(peer, params.threadId),
    'thread.unsubscribe': (peer, params: { threadId: string }) => {
      peer.subscriptions.delete(params.threadId);
      return null;
    },
    'thread.prompt': (_p, params) => hub.prompt(params),
    'thread.cancel': (_p, params: { threadId: string }) => hub.cancel(params.threadId),
    'thread.setConfig': (_p, params: ParamsOf<'thread.setConfig'>) => hub.setConfig(params),
    'thread.respondPermission': (_p, params) => hub.respondPermission(params),
    'thread.rename': (_p, params) => hub.rename(params),
    'thread.delete': (_p, params: { threadId: string }) => hub.deleteThread(params.threadId),
  };
}

/** A transport-agnostic client peer: one connected app. */
export function createPeer(hub: Hub, send: (msg: ServerMessage) => void): Peer {
  const peer: Peer = { send: (p) => send(p), subscriptions: new Set() };
  hub.addPeer(peer);
  return peer;
}

export function removePeer(hub: Hub, peer: Peer): void {
  hub.removePeer(peer);
}

/** Handle one raw JSON message from a peer. Transport-agnostic (WebSocket, stdio, …). */
export async function dispatch(hub: Hub, peer: Peer, raw: string): Promise<void> {
  const table = handlers(hub);
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  if (msg?.type !== 'req' || typeof msg.id !== 'number') return;
  const handler = table[msg.method];
  if (!handler) {
    peer.send({ type: 'res', id: msg.id, ok: false, error: { message: `Unknown method: ${String(msg.method)}`, code: 'unknown_method' } } as ServerMessage);
    return;
  }
  try {
    const result = await handler(peer, (msg.params ?? {}) as never);
    peer.send({ type: 'res', id: msg.id, ok: true, result: result ?? null } as ServerMessage);
  } catch (err) {
    const user = err instanceof UserError || err instanceof ProviderError;
    if (!user) console.error(`[differ] ${msg.method} failed:`, err);
    peer.send({ type: 'res', id: msg.id, ok: false, error: { message: err instanceof Error ? err.message : String(err), code: user ? 'user' : 'internal' } } as ServerMessage);
  }
}
