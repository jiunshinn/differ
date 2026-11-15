import type { Method, ParamsOf, Push, ResultOf, ServerEndpoint, ServerMessage } from '@shared/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/**
 * WebSocket client for the differ server. Reconnects with backoff; asks
 * `getEndpoint` again on each attempt so a restarted server (new port/token) is found.
 */
export class ServerConnection {
  private ws: WebSocket | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private retry = 0;
  private stopped = false;
  status: ConnectionStatus = 'connecting';

  constructor(
    private getEndpoint: () => Promise<ServerEndpoint>,
    private handlers: {
      onPush: (p: Push) => void;
      onStatus: (s: ConnectionStatus) => void;
      /** Called after every successful (re)connect, before queued calls resolve. */
      onOpen: () => void;
      /** Why the last attempt failed, e.g. "ssh: connect to host … refused". */
      onError?: (message: string) => void;
    },
  ) {
    void this.open();
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.handlers.onStatus(s);
  }

  private async open() {
    if (this.stopped) return;
    this.setStatus('connecting');
    let endpoint: ServerEndpoint;
    try {
      endpoint = await this.getEndpoint();
    } catch (err) {
      this.handlers.onError?.(err instanceof Error ? err.message : String(err));
      this.setStatus('closed');
      this.scheduleReconnect();
      return;
    }
    const ws = new WebSocket(`${endpoint.url}/?token=${encodeURIComponent(endpoint.token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      this.handlers.onOpen();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.type === 'res') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error.message));
      } else {
        this.handlers.onPush(msg);
      }
    };
    ws.onerror = () => this.handlers.onError?.('Could not reach the differ server on this machine');
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const p of this.pending.values()) p.reject(new Error('Lost connection to the differ server'));
      this.pending.clear();
      this.setStatus('closed');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(30_000, 250 * 2 ** this.retry++);
    setTimeout(() => void this.open(), delay);
  }

  call<M extends Method>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the differ server'));
    const id = ++this.nextId;
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
  }

  /** Drop the current socket and connect again (e.g. after switching environment). */
  reconnect() {
    this.retry = 0;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    void this.open();
  }

  close() {
    this.stopped = true;
    this.ws?.close();
  }
}
