import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type {
  HiddenModels,
  ProviderModels,
  ServerMessage,
  HelloResult,
  ParamsOf,
  Push,
  ResultOf,
  TerminalState,
  ThreadEvent,
  ThreadStatus,
  ThreadSummary,
} from '../../shared/protocol.js';
import { PROTOCOL_VERSION } from '../../shared/protocol.js';
import { AcpSession } from './acpSession.js';
import type { ModelPrefs } from './modelPrefs.js';
import { probeConfig } from './probe.js';
import type { ProviderSpec } from '../../shared/protocol.js';
import type { Providers } from './providers.js';
import type { Store } from './store.js';

export const SERVER_VERSION = '0.1.0';

/** A connected app (one WebSocket). */
export interface Peer {
  send(msg: Push | ServerMessage): void;
  subscriptions: Set<string>;
}

export class UserError extends Error {}

const titleFrom = (text: string) => {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New thread';
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Owns threads, their agent sessions, and the connected apps watching them. */
export class Hub {
  private peers = new Set<Peer>();
  private sessions = new Map<string, AcpSession>();
  private busy = new Set<string>();
  /** Model lists per provider: asking means starting an agent, so keep them. */
  private modelCache = new Map<string, { at: number; value: ProviderModels }>();
  /** Model picked before the thread's session existed. */
  private pendingModel = new Map<string, { configId: string; value: string }>();

  constructor(
    private store: Store,
    private providers: Providers,
    private prefs: ModelPrefs,
  ) {}

  addPeer(peer: Peer) {
    this.peers.add(peer);
  }

  removePeer(peer: Peer) {
    this.peers.delete(peer);
  }

  private broadcast(msg: Push, threadId?: string) {
    for (const p of this.peers) if (!threadId || p.subscriptions.has(threadId)) p.send(msg);
  }

  private emit(threadId: string, event: ThreadEvent) {
    const record = this.store.appendEvent(threadId, event);
    this.broadcast({ type: 'push', push: 'event', record }, threadId);
    if (event.kind === 'acp_update' && event.update.sessionUpdate === 'session_info_update' && event.update.title) {
      this.setThread(threadId, { title: event.update.title });
    }
  }

  private setThread(threadId: string, patch: { title?: string; status?: ThreadStatus; error?: string | null }): ThreadSummary | null {
    const thread = this.store.updateThread(threadId, patch);
    if (thread) this.broadcast({ type: 'push', push: 'thread', thread });
    return thread;
  }

  private thread(threadId: string): ThreadSummary {
    const t = this.store.getThread(threadId);
    if (!t) throw new UserError('Thread not found');
    return t;
  }

  private agent(providerId: string): ProviderSpec {
    const a = this.providers.get(providerId);
    if (!a) throw new UserError(`Unknown provider: ${providerId}`);
    return a;
  }

  private async session(thread: ThreadSummary): Promise<AcpSession> {
    const existing = this.sessions.get(thread.id);
    if (existing?.started) return existing;
    existing?.dispose();
    const id = thread.id;
    const s = new AcpSession(
      this.agent(thread.agentId),
      thread.cwd,
      {
        emit: (event) => this.emit(id, event),
        waiting: (w) => this.setThread(id, { status: w ? 'waiting' : 'running' }),
        terminal: (terminal: TerminalState) => this.broadcast({ type: 'push', push: 'terminal', threadId: id, terminal }, id),
        crashed: (message) => {
          this.sessions.delete(id);
          this.busy.delete(id);
          this.emit(id, { kind: 'error', message });
          this.setThread(id, { status: 'failed', error: message });
        },
      },
      SERVER_VERSION,
    );
    this.sessions.set(id, s);
    this.setThread(id, { status: 'starting', error: null });
    const fail = (message: string) => {
      this.sessions.delete(id);
      this.pendingModel.delete(id);
      s.dispose();
      return new Error(message);
    };
    try {
      await s.start();
    } catch (err) {
      const tail = s.stderrTail();
      throw fail(`Couldn't start ${this.agent(thread.agentId).name}: ${errorMessage(err)}${tail ? `\n${tail}` : ''}`);
    }
    const model = this.pendingModel.get(id);
    if (model) {
      this.pendingModel.delete(id);
      try {
        await s.setConfig(model.configId, model.value);
      } catch (err) {
        throw fail(`Couldn't select that model: ${errorMessage(err)}`);
      }
    }
    return s;
  }

  /** Run one prompt turn in the background; state changes reach clients as pushes. */
  private runTurn(threadId: string, text: string) {
    this.busy.add(threadId);
    this.emit(threadId, { kind: 'user_message', content: [{ type: 'text', text }] });
    void (async () => {
      try {
        const s = await this.session(this.thread(threadId));
        this.setThread(threadId, { status: 'running', error: null });
        const stopReason = await s.prompt([{ type: 'text', text }]);
        this.emit(threadId, { kind: 'turn_end', stopReason });
        this.setThread(threadId, { status: 'idle' });
      } catch (err) {
        const message = errorMessage(err);
        // A crash is already reported by the session's crashed() hook.
        if (this.store.getThread(threadId)?.status !== 'failed') {
          this.emit(threadId, { kind: 'error', message });
          this.setThread(threadId, { status: 'failed', error: message });
        }
      } finally {
        this.busy.delete(threadId);
      }
    })();
  }

  // ─── Request handlers ─────────────────────────────────────────────────────

  hello(): HelloResult {
    return {
      protocol: PROTOCOL_VERSION,
      serverVersion: SERVER_VERSION,
      hostname: os.hostname(),
      providers: this.providers.list(),
      threads: this.store.listThreads(),
    };
  }

  listProviders(): ResultOf<'providers.list'> {
    return this.providers.list();
  }

  saveProvider(p: ParamsOf<'providers.save'>): ResultOf<'providers.save'> {
    const saved = this.providers.save(p.provider);
    this.modelCache.delete(saved.id);
    return saved;
  }

  deleteProvider(id: string): null {
    this.providers.delete(id);
    this.modelCache.delete(id);
    return null;
  }

  /**
   * The model selector an agent offers. Agents only reveal config options once
   * a session exists, so this opens a throwaway one and caches the answer.
   */
  async providerModels(p: ParamsOf<'providers.models'>): Promise<ResultOf<'providers.models'>> {
    const spec = this.agent(p.providerId);
    const disabled = this.prefs.get(spec.id);
    const fresh = Date.now() - (this.modelCache.get(spec.id)?.at ?? 0) < 10 * 60_000;
    if (fresh) return { ...this.modelCache.get(spec.id)!.value, disabled };
    const cwd = p.cwd && path.isAbsolute(p.cwd) && fs.existsSync(p.cwd) ? p.cwd : os.homedir();
    try {
      const { selector } = await probeConfig(spec, cwd, SERVER_VERSION);
      this.modelCache.set(spec.id, { at: Date.now(), value: { selector, disabled: [] } });
      return { selector, disabled };
    } catch (err) {
      // Not fatal: the thread can still start with the agent's default model.
      return { selector: null, disabled, error: errorMessage(err) };
    }
  }

  hiddenModels(): ResultOf<'models.prefs'> {
    return this.prefs.all();
  }

  saveHiddenModels(p: ParamsOf<'models.savePrefs'>): ResultOf<'models.savePrefs'> {
    this.agent(p.providerId);
    return this.prefs.set(p.providerId, p.disabled);
  }

  createThread(p: ParamsOf<'thread.create'>): ResultOf<'thread.create'> {
    this.agent(p.providerId);
    if (!path.isAbsolute(p.cwd) || !fs.existsSync(p.cwd) || !fs.statSync(p.cwd).isDirectory()) {
      throw new UserError(`Folder not found: ${p.cwd}`);
    }
    if (!p.text.trim()) throw new UserError('Write a message for the agent');
    const thread = this.store.createThread({
      id: randomUUID(),
      title: p.title?.trim() || titleFrom(p.text),
      agentId: p.providerId,
      cwd: p.cwd,
      status: 'starting',
    });
    if (p.model) this.pendingModel.set(thread.id, p.model);
    this.broadcast({ type: 'push', push: 'thread', thread });
    this.runTurn(thread.id, p.text);
    return thread;
  }

  subscribe(peer: Peer, threadId: string): ResultOf<'thread.subscribe'> {
    const thread = this.thread(threadId);
    peer.subscriptions.add(threadId);
    return {
      thread,
      events: this.store.listEvents(threadId),
      terminals: this.sessions.get(threadId)?.terminals.live() ?? [],
    };
  }

  prompt(p: ParamsOf<'thread.prompt'>): null {
    this.thread(p.threadId);
    if (!p.text.trim()) throw new UserError('Write a message for the agent');
    if (this.busy.has(p.threadId)) throw new UserError('The agent is still working. Stop it or wait for it to finish.');
    this.runTurn(p.threadId, p.text);
    return null;
  }

  async cancel(threadId: string): Promise<null> {
    this.thread(threadId);
    await this.sessions.get(threadId)?.cancel();
    return null;
  }

  async setConfig(p: ParamsOf<'thread.setConfig'>): Promise<null> {
    this.thread(p.threadId);
    const s = this.sessions.get(p.threadId);
    if (!s?.started) throw new UserError('The agent is still starting. Try again in a moment.');
    await s.setConfig(p.configId, p.value);
    return null;
  }

  respondPermission(p: ParamsOf<'thread.respondPermission'>): null {
    const s = this.sessions.get(p.threadId);
    if (!s || !s.respondPermission(p.requestId, p.optionId)) throw new UserError('That request is no longer waiting for an answer');
    return null;
  }

  rename(p: ParamsOf<'thread.rename'>): ThreadSummary {
    const title = p.title.trim();
    if (!title) throw new UserError('Title can’t be empty');
    this.thread(p.threadId);
    return this.setThread(p.threadId, { title })!;
  }

  deleteThread(threadId: string): null {
    this.sessions.get(threadId)?.dispose();
    this.sessions.delete(threadId);
    this.busy.delete(threadId);
    this.store.deleteThread(threadId);
    for (const p of this.peers) p.subscriptions.delete(threadId);
    this.broadcast({ type: 'push', push: 'thread_deleted', threadId });
    return null;
  }

  dispose() {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }
}
