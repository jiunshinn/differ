/**
 * Wire protocol between the differ server and its clients (desktop, mobile).
 *
 * Transport: one WebSocket per client, JSON text frames.
 *   client → server  { type: 'req', id, method, params }
 *   server → client  { type: 'res', id, ok: true, result } | { type: 'res', id, ok: false, error }
 *   server → client  { type: 'push', ... }  (thread events, summaries, terminal output)
 *
 * A thread is an append-only log of ThreadEvents. Clients rebuild the view with
 * reduceThread(), so desktop and mobile render the same thing from the same data.
 *
 * Type-only imports from the ACP SDK keep this file free of runtime dependencies.
 */
import type {
  ContentBlock,
  PermissionOption,
  PlanEntry,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
  StopReason,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
  AvailableCommand,
} from '@agentclientprotocol/sdk';

export const PROTOCOL_VERSION = 1;

// ─── Providers (ACP agents) ─────────────────────────────────────────────────

/** How to launch one ACP agent over stdio. */
export interface ProviderSpec {
  /** Stable id, also stored on threads. Lowercase letters, digits and dashes. */
  id: string;
  name: string;
  description?: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ProviderInfo extends ProviderSpec {
  /**
   * Where the provider came from: 'builtin' ships with differ, 'detected' was
   * found on this machine's PATH, 'file' comes from agents.json, 'env' from
   * DIFFER_AGENTS. Only 'file' entries can be edited or removed in the app.
   */
  source: 'builtin' | 'detected' | 'file' | 'env';
  /** False when the command isn't found on the server's PATH. */
  available: boolean;
}

/** One selectable value of a session config option. */
export interface ConfigChoice {
  value: string;
  name: string;
  description?: string | null;
}

/** A select config option the agent advertises, e.g. its model selector. */
export interface ConfigSelector {
  configId: string;
  label: string;
  description?: string | null;
  current: string | null;
  choices: ConfigChoice[];
}

function choicesOf(option: Extract<SessionConfigOption, { type: 'select' }>): ConfigChoice[] {
  const out: ConfigChoice[] = [];
  for (const item of option.options) {
    // Values may be grouped under headers; flatten them for a simple list.
    const items = 'options' in item ? item.options : [item];
    for (const o of items) out.push({ value: o.value, name: o.name, description: o.description ?? null });
  }
  return out;
}

/**
 * The model selector among an agent's config options. Agents label these
 * inconsistently, so prefer the ACP category and fall back to the name.
 */
export function modelSelector(options: SessionConfigOption[] | null | undefined): ConfigSelector | null {
  if (!options?.length) return null;
  const select = options.filter((o): o is Extract<SessionConfigOption, { type: 'select' }> => o.type === 'select');
  const hit = select.find((o) => o.category === 'model') ?? select.find((o) => /model/i.test(o.id) || /model/i.test(o.name));
  if (!hit) return null;
  const choices = choicesOf(hit);
  if (!choices.length) return null;
  return { configId: hit.id, label: hit.name, description: hit.description ?? null, current: hit.currentValue ?? null, choices };
}

/**
 * What an agent offers before a thread exists. Agents only reveal config
 * options once a session is created, so the server asks with a throwaway one.
 */
export interface ProviderModels {
  /** null when the agent exposes no model selector. */
  selector: ConfigSelector | null;
  /** Model values the user hid in Settings → Models. */
  disabled: string[];
  /** Why there is nothing to show, when asking the agent failed. */
  error?: string | null;
}

/** Model values hidden from pickers, keyed by provider id. */
export type HiddenModels = Record<string, string[]>;

/** The choices a picker should offer, minus the ones the user turned off. */
export function visibleChoices(selector: ConfigSelector | null, disabled: string[] | undefined): ConfigChoice[] {
  if (!selector) return [];
  if (!disabled?.length) return selector.choices;
  return selector.choices.filter((c) => !disabled.includes(c.value));
}

// ─── Threads ────────────────────────────────────────────────────────────────

/** running = agent is working, waiting = a permission request needs the user. */
export type ThreadStatus = 'starting' | 'idle' | 'running' | 'waiting' | 'failed';

export interface ThreadSummary {
  id: string;
  title: string;
  agentId: string;
  /** Absolute working directory on the server host. */
  cwd: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  /** Last error, when status is 'failed'. */
  error?: string | null;
}

export type ThreadEvent =
  | { kind: 'user_message'; content: ContentBlock[] }
  | { kind: 'session_started'; acpSessionId: string; modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null; agentName?: string | null }
  | { kind: 'acp_update'; update: SessionUpdate }
  | { kind: 'permission_request'; requestId: string; toolCall: ToolCallUpdate; options: PermissionOption[] }
  | { kind: 'permission_resolved'; requestId: string; optionId: string | null }
  | { kind: 'terminal_snapshot'; terminalId: string; command: string; output: string; truncated: boolean; exitCode: number | null; signal: string | null }
  | { kind: 'turn_end'; stopReason: StopReason }
  | { kind: 'error'; message: string };

export interface ThreadEventRecord {
  threadId: string;
  seq: number;
  at: string;
  event: ThreadEvent;
}

/** Live terminal output. Not persisted; a terminal_snapshot event is stored when it exits or is released. */
export interface TerminalState {
  terminalId: string;
  command: string;
  output: string;
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  running: boolean;
}

// ─── Requests ───────────────────────────────────────────────────────────────

export interface HelloResult {
  protocol: number;
  serverVersion: string;
  hostname: string;
  providers: ProviderInfo[];
  threads: ThreadSummary[];
}

export interface Requests {
  hello: { params: { client: string }; result: HelloResult };
  'threads.list': { params: Record<string, never>; result: ThreadSummary[] };
  'providers.list': { params: Record<string, never>; result: ProviderInfo[] };
  'providers.models': { params: { providerId: string; cwd?: string }; result: ProviderModels };
  'models.prefs': { params: Record<string, never>; result: HiddenModels };
  'models.savePrefs': { params: { providerId: string; disabled: string[] }; result: HiddenModels };
  'providers.save': { params: { provider: ProviderSpec }; result: ProviderInfo };
  'providers.delete': { params: { id: string }; result: null };
  'thread.create': {
    params: { providerId: string; cwd: string; text: string; title?: string; model?: { configId: string; value: string } };
    result: ThreadSummary;
  };
  'thread.subscribe': { params: { threadId: string }; result: { thread: ThreadSummary; events: ThreadEventRecord[]; terminals: TerminalState[] } };
  'thread.unsubscribe': { params: { threadId: string }; result: null };
  'thread.prompt': { params: { threadId: string; text: string }; result: null };
  'thread.cancel': { params: { threadId: string }; result: null };
  'thread.setConfig': { params: { threadId: string; configId: string; value: string }; result: null };
  'thread.respondPermission': { params: { threadId: string; requestId: string; optionId: string | null }; result: null };
  'thread.rename': { params: { threadId: string; title: string }; result: ThreadSummary };
  'thread.delete': { params: { threadId: string }; result: null };
}

export type Method = keyof Requests;
export type ParamsOf<M extends Method> = Requests[M]['params'];
export type ResultOf<M extends Method> = Requests[M]['result'];

export type ClientMessage = { type: 'req'; id: number; method: Method; params: unknown };

export type Push =
  | { type: 'push'; push: 'thread'; thread: ThreadSummary }
  | { type: 'push'; push: 'thread_deleted'; threadId: string }
  | { type: 'push'; push: 'event'; record: ThreadEventRecord }
  | { type: 'push'; push: 'terminal'; threadId: string; terminal: TerminalState };

export type ServerMessage =
  | { type: 'res'; id: number; ok: true; result: unknown }
  | { type: 'res'; id: number; ok: false; error: { message: string; code?: string } }
  | Push;

/** How the desktop app finds its local server. */
export interface ServerEndpoint {
  url: string;
  token: string;
}

// ─── View model ─────────────────────────────────────────────────────────────

export interface ToolCallView {
  toolCallId: string;
  title: string;
  name?: string | null;
  kind: ToolKind;
  status: ToolCallStatus;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export type ThreadItem =
  | { type: 'user'; key: string; text: string }
  | { type: 'agent'; key: string; text: string }
  | { type: 'thought'; key: string; text: string }
  | { type: 'tool'; key: string; tool: ToolCallView }
  | { type: 'plan'; key: string; entries: PlanEntry[] }
  | { type: 'permission'; key: string; requestId: string; toolCall: ToolCallUpdate; options: PermissionOption[]; resolved: boolean; optionId: string | null }
  | { type: 'notice'; key: string; severity: string; title: string; description?: string | null }
  | { type: 'error'; key: string; message: string }
  | { type: 'turn_end'; key: string; stopReason: StopReason };

export interface ThreadView {
  items: ThreadItem[];
  /** Current plan, if the agent reported one. */
  plan: PlanEntry[] | null;
  usage: { used: number; size: number } | null;
  modes: SessionModeState | null;
  /** Session config selectors (model, reasoning level…) and their current values. */
  configOptions: SessionConfigOption[] | null;
  commands: AvailableCommand[];
  agentName: string | null;
  title: string | null;
  /** Unresolved permission requests, oldest first. */
  pendingPermissions: string[];
  terminals: Record<string, TerminalState>;
}

const textOf = (c: ContentBlock): string => {
  switch (c.type) {
    case 'text':
      return c.text;
    case 'resource_link':
      return `@${c.name}`;
    case 'resource':
      return 'uri' in c.resource ? `@${c.resource.uri}` : '';
    default:
      return '';
  }
};

/** Rebuild the thread view from its event log. Pure; safe to call on every new event. */
export function reduceThread(records: ThreadEventRecord[], liveTerminals: TerminalState[] = []): ThreadView {
  const view: ThreadView = {
    items: [],
    plan: null,
    usage: null,
    modes: null,
    configOptions: null,
    commands: [],
    agentName: null,
    title: null,
    pendingPermissions: [],
    terminals: {},
  };
  const tools = new Map<string, ToolCallView>();
  const pending = new Set<string>();
  let planIndex = -1;

  const appendText = (type: 'agent' | 'thought' | 'user', key: string, text: string) => {
    const last = view.items[view.items.length - 1];
    if (last && last.type === type) {
      view.items[view.items.length - 1] = { ...last, text: last.text + text };
    } else {
      view.items.push({ type, key, text });
    }
  };

  for (const rec of records) {
    const key = `${rec.seq}`;
    const ev = rec.event;
    switch (ev.kind) {
      case 'user_message':
        view.items.push({ type: 'user', key, text: ev.content.map(textOf).join('') });
        break;
      case 'session_started':
        view.modes = ev.modes ?? null;
        view.configOptions = ev.configOptions ?? null;
        view.agentName = ev.agentName ?? view.agentName;
        break;
      case 'permission_request':
        pending.add(ev.requestId);
        view.items.push({ type: 'permission', key, requestId: ev.requestId, toolCall: ev.toolCall, options: ev.options, resolved: false, optionId: null });
        break;
      case 'permission_resolved': {
        pending.delete(ev.requestId);
        const i = view.items.findIndex((it) => it.type === 'permission' && it.requestId === ev.requestId);
        if (i >= 0) view.items[i] = { ...(view.items[i] as Extract<ThreadItem, { type: 'permission' }>), resolved: true, optionId: ev.optionId };
        break;
      }
      case 'terminal_snapshot':
        view.terminals[ev.terminalId] = {
          terminalId: ev.terminalId,
          command: ev.command,
          output: ev.output,
          truncated: ev.truncated,
          exitCode: ev.exitCode,
          signal: ev.signal,
          running: false,
        };
        break;
      case 'turn_end':
        view.items.push({ type: 'turn_end', key, stopReason: ev.stopReason });
        // A finished turn leaves nothing to approve.
        for (const id of pending) {
          const i = view.items.findIndex((it) => it.type === 'permission' && it.requestId === id);
          if (i >= 0) view.items[i] = { ...(view.items[i] as Extract<ThreadItem, { type: 'permission' }>), resolved: true };
        }
        pending.clear();
        break;
      case 'error':
        view.items.push({ type: 'error', key, message: ev.message });
        break;
      case 'acp_update': {
        const u = ev.update;
        switch (u.sessionUpdate) {
          case 'user_message_chunk':
            appendText('user', key, textOf(u.content));
            break;
          case 'agent_message_chunk':
            appendText('agent', key, textOf(u.content));
            break;
          case 'agent_thought_chunk':
            appendText('thought', key, textOf(u.content));
            break;
          case 'tool_call': {
            const tool: ToolCallView = {
              toolCallId: u.toolCallId,
              title: u.title,
              name: u.name,
              kind: u.kind ?? 'other',
              status: u.status ?? 'pending',
              content: u.content ?? [],
              locations: u.locations ?? [],
              rawInput: u.rawInput,
              rawOutput: u.rawOutput,
            };
            tools.set(u.toolCallId, tool);
            view.items.push({ type: 'tool', key: `tool-${u.toolCallId}`, tool });
            break;
          }
          case 'tool_call_update': {
            const prev = tools.get(u.toolCallId);
            // Upsert: an update for an unknown id creates the call.
            const next: ToolCallView = {
              toolCallId: u.toolCallId,
              title: u.title ?? prev?.title ?? 'Tool call',
              name: u.name ?? prev?.name,
              kind: u.kind ?? prev?.kind ?? 'other',
              status: u.status ?? prev?.status ?? 'pending',
              content: u.content === undefined ? (prev?.content ?? []) : (u.content ?? []),
              locations: u.locations === undefined ? (prev?.locations ?? []) : (u.locations ?? []),
              rawInput: u.rawInput === undefined ? prev?.rawInput : u.rawInput,
              rawOutput: u.rawOutput === undefined ? prev?.rawOutput : u.rawOutput,
            };
            tools.set(u.toolCallId, next);
            const i = view.items.findIndex((it) => it.type === 'tool' && it.tool.toolCallId === u.toolCallId);
            if (i >= 0) view.items[i] = { type: 'tool', key: view.items[i].key, tool: next };
            else view.items.push({ type: 'tool', key: `tool-${u.toolCallId}`, tool: next });
            break;
          }
          case 'plan':
            view.plan = u.entries;
            if (planIndex >= 0) view.items[planIndex] = { type: 'plan', key: view.items[planIndex].key, entries: u.entries };
            else {
              planIndex = view.items.length;
              view.items.push({ type: 'plan', key, entries: u.entries });
            }
            break;
          case 'available_commands_update':
            view.commands = u.availableCommands;
            break;
          case 'current_mode_update':
            if (view.modes) view.modes = { ...view.modes, currentModeId: u.currentModeId };
            break;
          case 'session_info_update':
            if (u.title) view.title = u.title;
            break;
          case 'usage_update':
            view.usage = { used: u.used, size: u.size };
            break;
          case 'notice':
            view.items.push({ type: 'notice', key, severity: u.severity, title: u.title, description: u.description });
            break;
          case 'config_option_update':
            view.configOptions = u.configOptions;
            break;
          default:
            // compaction_*: not rendered yet.
            break;
        }
        break;
      }
    }
  }

  for (const t of liveTerminals) view.terminals[t.terminalId] = t;
  view.pendingPermissions = [...pending];
  return view;
}
