import { create } from 'zustand';
import type { HiddenModels, ProviderInfo, ProviderModels, ProviderSpec, Push, TerminalState, ThreadEventRecord, ThreadSummary } from '@shared/protocol';
import type { EnvironmentCheck, EnvironmentDraft, EnvironmentList } from '@shared/types';
import { api } from '../api';
import { ServerConnection, type ConnectionStatus } from './connection';

export interface ThreadData {
  events: ThreadEventRecord[];
  terminals: Record<string, TerminalState>;
  loaded: boolean;
}

/** A thread plus the machine it lives on. Thread ids are only unique per server. */
export type ThreadRef = ThreadSummary & { envId: string };

/** What we know about one machine's differ server. */
export interface EnvRuntime {
  status: ConnectionStatus;
  hostname: string | null;
  providers: ProviderInfo[];
  hiddenModels: HiddenModels;
  threads: ThreadSummary[];
  /** Why the last connection attempt failed. */
  error: string | null;
}

interface NewThreadState {
  envId: string;
  folder: string | null;
}

interface AgentState {
  environments: EnvironmentList;
  /** Runtime state per environment id ('local' or an ssh env id). */
  envs: Record<string, EnvRuntime>;
  /** Threads from every connected machine, newest first. */
  threads: ThreadRef[];
  data: Record<string, ThreadData>;
  /** `${envId}:${threadId}` of the open thread; null shows the new-thread screen. */
  selectedKey: string | null;
  newThread: NewThreadState;
  settingsOpen: boolean;
  /** Settings panel instead of a thread. */

  connect(): void;
  connectEnvironment(id: string): void;
  /** Tear the connection down and try again from scratch. */
  reconnectEnvironment(id: string): void;
  disconnectEnvironment(id: string): void;
  select(envId: string | null, threadId: string | null): void;
  openNewThread(envId?: string, folder?: string | null): void;
  openSettings(open: boolean): void;
  createThread(input: {
    envId: string;
    providerId: string;
    cwd: string;
    text: string;
    title?: string;
    model?: { configId: string; value: string };
  }): Promise<ThreadRef>;
  /** The model selector a provider offers, probed with a throwaway session. */
  providerModels(envId: string, providerId: string, cwd?: string): Promise<ProviderModels>;
  setThreadConfig(envId: string, threadId: string, configId: string, value: string): Promise<void>;
  saveHiddenModels(envId: string, providerId: string, disabled: string[]): Promise<void>;
  saveProvider(envId: string, provider: ProviderSpec): Promise<ProviderInfo>;
  deleteProvider(envId: string, id: string): Promise<void>;
  refreshEnvironments(): Promise<void>;
  saveEnvironment(draft: EnvironmentDraft): Promise<void>;
  /** Pick the machine new threads start on. Connections stay up. */
  setDefaultEnvironment(id: string): Promise<void>;
  deleteEnvironment(id: string): Promise<void>;
  checkEnvironment(id: string): Promise<EnvironmentCheck>;
  bootstrapEnvironment(id: string): Promise<EnvironmentCheck>;
  prompt(envId: string, threadId: string, text: string): Promise<void>;
  cancel(envId: string, threadId: string): Promise<void>;
  respondPermission(envId: string, threadId: string, requestId: string, optionId: string | null): Promise<void>;
  rename(envId: string, threadId: string, title: string): Promise<void>;
  remove(envId: string, threadId: string): Promise<void>;
}

const SELECTED_KEY = 'differ.selectedThread';
const DEFAULT_ENV = 'local';

export const threadKey = (envId: string, threadId: string) => `${envId}:${threadId}`;

export const EMPTY_RUNTIME: EnvRuntime = {
  status: 'closed',
  hostname: null,
  providers: [],
  hiddenModels: {},
  threads: [],
  error: null,
};

const byRecent = (a: ThreadSummary, b: ThreadSummary) => b.updatedAt.localeCompare(a.updatedAt);

/** Flatten every machine's threads into one list with the env attached. */
function flatten(envs: Record<string, EnvRuntime>): ThreadRef[] {
  const out: ThreadRef[] = [];
  for (const [envId, runtime] of Object.entries(envs)) {
    for (const t of runtime.threads) out.push({ ...t, envId });
  }
  return out.sort(byRecent);
}

function runtimeOf(envs: Record<string, EnvRuntime>, envId: string): EnvRuntime {
  return envs[envId] ?? EMPTY_RUNTIME;
}

/** Apply a patch to one environment and refresh the flattened thread list. */
function patchEnv(
  state: AgentState,
  envId: string,
  patch: Partial<EnvRuntime>,
): Pick<AgentState, 'envs' | 'threads'> {
  const envs = { ...state.envs, [envId]: { ...runtimeOf(state.envs, envId), ...patch } };
  return { envs, threads: flatten(envs) };
}

function readRememberedSelection(): string | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return null;
    // Older builds stored a bare thread id; assume it was the local machine.
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { envId?: string; threadId?: string };
      return parsed.envId && parsed.threadId ? threadKey(parsed.envId, parsed.threadId) : null;
    }
    return threadKey(DEFAULT_ENV, raw);
  } catch {
    return null;
  }
}

/** One live server connection per environment. */
const connections = new Map<string, ServerConnection>();

function client(envId: string): ServerConnection {
  const conn = connections.get(envId);
  if (!conn) throw new Error('Not connected to that machine');
  return conn;
}

export const useAgentStore = create<AgentState>((set, get) => {
  const setEnv = (envId: string, patch: Partial<EnvRuntime>) =>
    set((s) => patchEnv(s, envId, patch));

  const upsertThread = (envId: string, thread: ThreadSummary) =>
    set((s) => {
      const runtime = runtimeOf(s.envs, envId);
      const threads = [thread, ...runtime.threads.filter((t) => t.id !== thread.id)].sort(byRecent);
      return patchEnv(s, envId, { threads });
    });

  const load = async (envId: string, threadId: string) => {
    const res = await client(envId).call('thread.subscribe', { threadId });
    upsertThread(envId, res.thread);
    const key = threadKey(envId, threadId);
    set((s) => {
      // Keep any pushes that arrived after the snapshot was taken.
      const prev = s.data[key]?.events ?? [];
      const last = res.events.at(-1)?.seq ?? 0;
      const events = [...res.events, ...prev.filter((e) => e.seq > last)];
      return {
        data: {
          ...s.data,
          [key]: {
            events,
            terminals: Object.fromEntries(res.terminals.map((t) => [t.terminalId, t])),
            loaded: true,
          },
        },
      };
    });
  };

  const onPush = (envId: string, p: Push) => {
    switch (p.push) {
      case 'thread':
        upsertThread(envId, p.thread);
        break;
      case 'thread_deleted': {
        const key = threadKey(envId, p.threadId);
        set((s) => {
          const data = { ...s.data };
          delete data[key];
          const runtime = runtimeOf(s.envs, envId);
          const next = patchEnv(s, envId, { threads: runtime.threads.filter((t) => t.id !== p.threadId) });
          return {
            ...next,
            data,
            selectedKey: s.selectedKey === key ? null : s.selectedKey,
          };
        });
        break;
      }
      case 'event': {
        const key = threadKey(envId, p.record.threadId);
        set((s) => {
          const cur = s.data[key] ?? { events: [], terminals: {}, loaded: false };
          if (cur.events.length && cur.events[cur.events.length - 1].seq >= p.record.seq) return s;
          return { data: { ...s.data, [key]: { ...cur, events: [...cur.events, p.record] } } };
        });
        break;
      }
      case 'terminal': {
        const key = threadKey(envId, p.threadId);
        set((s) => {
          const cur = s.data[key] ?? { events: [], terminals: {}, loaded: false };
          return {
            data: {
              ...s.data,
              [key]: { ...cur, terminals: { ...cur.terminals, [p.terminal.terminalId]: p.terminal } },
            },
          };
        });
        break;
      }
    }
  };

  /** Ask a machine for its providers and threads, and re-sync the threads we had open there. */
  const syncEnv = async (envId: string) => {
    const conn = client(envId);
    const hello = await conn.call('hello', { client: 'desktop' });
    const hiddenModels = await conn.call('models.prefs', {}).catch(() => runtimeOf(get().envs, envId).hiddenModels);
    set((s) =>
      patchEnv(s, envId, {
        status: 'open',
        hostname: hello.hostname,
        providers: hello.providers,
        threads: [...hello.threads].sort(byRecent),
        hiddenModels,
        error: null,
      }),
    );
    const open = Object.keys(get().data)
      .filter((k) => k.startsWith(`${envId}:`))
      .map((k) => k.slice(envId.length + 1));
    await Promise.all(open.map((id) => load(envId, id).catch(() => undefined)));
  };

  const connectEnvironment = (envId: string) => {
    if (connections.has(envId)) return;
    const conn = new ServerConnection(() => api.serverEndpoint(envId), {
      onPush: (p) => onPush(envId, p),
      onStatus: (status) =>
        set((s) =>
          patchEnv(s, envId, {
            status,
            // A successful connect should stop showing the old ssh error.
            error: status === 'open' ? null : runtimeOf(s.envs, envId).error,
          }),
        ),
      onError: (message) => setEnv(envId, { error: message }),
      onOpen: () => {
        void syncEnv(envId).catch((err) =>
          setEnv(envId, {
            status: 'closed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      },
    });
    connections.set(envId, conn);
    setEnv(envId, { status: 'connecting' });
  };

  return {
    environments: { activeId: DEFAULT_ENV, connectedIds: [], environments: [] },
    envs: {},
    threads: [],
    data: {},
    selectedKey: readRememberedSelection(),
    newThread: { envId: DEFAULT_ENV, folder: null },
    settingsOpen: false,

    connect() {
      const ids = get().environments.environments.map((e) => e.id);
      for (const id of ids.length ? ids : [DEFAULT_ENV]) connectEnvironment(id);
    },

    connectEnvironment(id) {
      connectEnvironment(id);
    },

    reconnectEnvironment(id) {
      const conn = connections.get(id);
      if (conn) {
        conn.close();
        connections.delete(id);
      }
      set((s) => patchEnv(s, id, { status: 'closed', error: null }));
      connectEnvironment(id);
    },

    disconnectEnvironment(id) {
      const conn = connections.get(id);
      if (conn) {
        conn.close();
        connections.delete(id);
      }
      set((s) => {
        const next = patchEnv(s, id, { status: 'closed', threads: [] });
        return next;
      });
      void api.envDisconnect(id).catch(() => undefined);
    },

    select(envId, threadId) {
      if (!envId || !threadId) {
        set({ selectedKey: null, settingsOpen: false });
        localStorage.removeItem(SELECTED_KEY);
        return;
      }
      const key = threadKey(envId, threadId);
      set({
        selectedKey: key,
        settingsOpen: false,
        // A folder remembered for another machine is meaningless here.
        newThread: { envId, folder: null },
      });
      localStorage.setItem(SELECTED_KEY, JSON.stringify({ envId, threadId }));
      if (!get().data[key]?.loaded && connections.get(envId)?.status === 'open') {
        void load(envId, threadId).catch(() => undefined);
      }
    },

    openNewThread(envId, folder) {
      set({
        selectedKey: null,
        settingsOpen: false,
        newThread: { envId: envId ?? get().environments.activeId ?? DEFAULT_ENV, folder: folder ?? null },
      });
      localStorage.removeItem(SELECTED_KEY);
    },

    openSettings(open) {
      set({ settingsOpen: open });
    },

    async saveProvider(envId, provider) {
      const saved = await client(envId).call('providers.save', { provider });
      set((s) => {
        const runtime = runtimeOf(s.envs, envId);
        return patchEnv(s, envId, {
          providers: [...runtime.providers.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
        });
      });
      return saved;
    },

    async deleteProvider(envId, id) {
      await client(envId).call('providers.delete', { id });
      set((s) => {
        const runtime = runtimeOf(s.envs, envId);
        return patchEnv(s, envId, { providers: runtime.providers.filter((p) => p.id !== id) });
      });
    },

    async refreshEnvironments() {
      const environments = await api.envList();
      set({ environments });
      // A newly added machine connects right away.
      for (const env of environments.environments) connectEnvironment(env.id);
    },

    async saveEnvironment(draft) {
      const saved = await api.envSave(draft);
      // Editing the host must not keep a connection to the old one.
      const previous = connections.get(saved.id);
      if (previous) {
        previous.close();
        connections.delete(saved.id);
      }
      await get().refreshEnvironments();
      connectEnvironment(saved.id);
    },

    async setDefaultEnvironment(id) {
      // The default is stored first; failing to connect shows up on the row, it shouldn't throw here.
      await api.envActivate(id).catch(() => undefined);
      await get().refreshEnvironments();
      connectEnvironment(id);
    },

    async deleteEnvironment(id) {
      const conn = connections.get(id);
      if (conn) {
        conn.close();
        connections.delete(id);
      }
      const environments = await api.envDelete(id);
      set((s) => {
        const envs = { ...s.envs };
        delete envs[id];
        const data = Object.fromEntries(Object.entries(s.data).filter(([k]) => !k.startsWith(`${id}:`)));
        const selectedKey = s.selectedKey?.startsWith(`${id}:`) ? null : s.selectedKey;
        return { environments, envs, data, selectedKey, threads: flatten(envs) };
      });
      if (get().newThread.envId === id) set({ newThread: { envId: environments.activeId, folder: null } });
    },

    checkEnvironment: (id) => api.envCheck(id),
    bootstrapEnvironment: (id) => api.envBootstrap(id),

    async createThread(input) {
      const { envId, ...rest } = input;
      const thread = await client(envId).call('thread.create', rest);
      upsertThread(envId, thread);
      get().select(envId, thread.id);
      await load(envId, thread.id);
      return { ...thread, envId };
    },

    async providerModels(envId, providerId, cwd) {
      return client(envId).call('providers.models', { providerId, cwd });
    },

    async setThreadConfig(envId, threadId, configId, value) {
      await client(envId).call('thread.setConfig', { threadId, configId, value });
    },

    async saveHiddenModels(envId, providerId, disabled) {
      const hiddenModels = await client(envId).call('models.savePrefs', { providerId, disabled });
      setEnv(envId, { hiddenModels });
    },

    async prompt(envId, threadId, text) {
      await client(envId).call('thread.prompt', { threadId, text });
    },

    async cancel(envId, threadId) {
      await client(envId).call('thread.cancel', { threadId });
    },

    async respondPermission(envId, threadId, requestId, optionId) {
      await client(envId).call('thread.respondPermission', { threadId, requestId, optionId });
    },

    async rename(envId, threadId, title) {
      upsertThread(envId, await client(envId).call('thread.rename', { threadId, title }));
    },

    async remove(envId, threadId) {
      await client(envId).call('thread.delete', { threadId });
    },
  };
});
