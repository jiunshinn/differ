import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type { CodexModel } from '../../shared/types';

interface RpcMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ActiveTurn {
  threadId: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  chunks: string[];
}

let client: CodexAppServerClient | null = null;

interface CodexTurnOptions {
  model?: string | null;
  effort?: string | null;
  serviceTier?: string | null;
}

export async function startCodexThread(cwd: string, options: CodexTurnOptions = {}): Promise<string> {
  const c = await getClient();
  const result = await c.request('thread/start', {
    cwd,
    ...codexSettingsParams(options),
  });
  const thread = readObject(result, 'thread/start result').thread;
  const threadId = typeof thread === 'object' && thread && 'id' in thread ? (thread as { id?: unknown }).id : null;
  if (typeof threadId !== 'string') throw new Error('Codex app-server did not return a thread id');
  return threadId;
}

export async function sendCodexTurn(threadId: string, text: string, options: CodexTurnOptions = {}): Promise<string> {
  const c = await getClient();
  return c.startTurn(threadId, text, options);
}

export async function listCodexModels(): Promise<CodexModel[]> {
  const c = await getClient();
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  do {
    const result = await c.request('model/list', {
      cursor,
      limit: 50,
      includeHidden: false,
    });
    const obj = readObject(result, 'model/list result');
    const data = Array.isArray(obj.data) ? obj.data : [];
    models.push(...data.map(normalizeCodexModel).filter((model): model is CodexModel => model != null));
    cursor = readString(obj.nextCursor);
  } while (cursor);
  return models;
}

async function getClient(): Promise<CodexAppServerClient> {
  if (!client) client = new CodexAppServerClient();
  await client.ready();
  return client;
}

class CodexAppServerClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private activeTurns = new Map<string, ActiveTurn>();
  private initPromise: Promise<void> | null = null;

  ready(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.start();
    return this.initPromise;
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    this.send({ id, method, ...(params ? { params } : {}) });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async startTurn(threadId: string, text: string, options: CodexTurnOptions): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Prompt is required');
    await this.ready();
    const pending = new Promise<string>((resolve, reject) => {
      this.activeTurns.set(threadId, { threadId, resolve, reject, chunks: [] });
    });
    try {
      await this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: trimmed }],
        ...codexSettingsParams(options),
      });
      return await pending;
    } catch (error) {
      this.activeTurns.delete(threadId);
      throw error;
    }
  }

  private async start(): Promise<void> {
    this.proc = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdin.setDefaultEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      // Keep stderr out of the renderer, but surface it if startup fails.
      if (this.pending.size === 0 && !this.rl) {
        console.error('[codex app-server]', chunk);
      }
    });
    this.proc.on('error', (err) => this.failAll(err));
    this.proc.on('close', (code) => {
      const error = new Error(`Codex app-server exited${code == null ? '' : ` with code ${code}`}`);
      this.failAll(error);
      client = null;
      this.initPromise = null;
    });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => this.handleLine(line));

    await this.request('initialize', {
      clientInfo: {
        name: 'differ',
        title: 'Differ',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.send({ method: 'initialized', params: {} });
  }

  private send(message: RpcMessage) {
    if (!this.proc || this.proc.killed) throw new Error('Codex app-server is not running');
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string) {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (typeof message.id === 'number' && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `Codex app-server error ${message.error.code ?? ''}`.trim()));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (typeof message.id === 'number' && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.method) this.handleNotification(message);
  }

  private handleServerRequest(message: RpcMessage) {
    // Until the UI has approval modals, decline server-initiated approvals so
    // the turn can finish instead of hanging forever.
    if (!this.proc || typeof message.id !== 'number') return;
    const method = message.method ?? '';
    if (method.includes('requestApproval')) {
      this.send({ id: message.id, result: 'decline' });
      return;
    }
    if (method === 'item/tool/requestUserInput') {
      this.send({ id: message.id, result: { answers: [] } });
      return;
    }
    this.send({ id: message.id, error: { code: -32601, message: `Unsupported client request: ${method}` } });
  }

  private handleNotification(message: RpcMessage) {
    const params = message.params ?? {};
    const threadId = readString(params.threadId) ?? readNestedString(params, ['turn', 'threadId']);
    if (message.method === 'item/agentMessage/delta') {
      const active = threadId ? this.activeTurns.get(threadId) : findSingleActiveTurn(this.activeTurns);
      const delta = readString(params.delta) ?? readString(params.text) ?? readString(params.content);
      if (active && delta) active.chunks.push(delta);
      return;
    }
    if (message.method === 'item/completed') {
      const item = readObject(params.item, 'item') as { type?: unknown; text?: unknown };
      if (item.type === 'agentMessage') {
        const active = threadId ? this.activeTurns.get(threadId) : findSingleActiveTurn(this.activeTurns);
        const text = readString(item.text);
        if (active && text && active.chunks.join('') !== text) active.chunks = [text];
      }
      return;
    }
    if (message.method === 'turn/completed') {
      const active = threadId ? this.activeTurns.get(threadId) : findSingleActiveTurn(this.activeTurns);
      if (!active) return;
      this.activeTurns.delete(active.threadId);
      const turn = readObject(params.turn, 'turn') as {
        status?: unknown;
        error?: { message?: unknown };
      };
      if (turn.status === 'failed') {
        active.reject(new Error(readString(turn.error?.message) ?? 'Codex turn failed'));
        return;
      }
      active.resolve(active.chunks.join('').trim() || 'Codex completed without a final message.');
    }
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const turn of this.activeTurns.values()) turn.reject(error);
    this.activeTurns.clear();
  }
}

function codexSettingsParams(options: CodexTurnOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (options.model) params.model = options.model;
  if (options.effort) params.effort = options.effort;
  if (options.serviceTier) params.serviceTier = options.serviceTier;
  return params;
}

function normalizeCodexModel(value: unknown): CodexModel | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = readString(raw.id) ?? readString(raw.model);
  const model = readString(raw.model) ?? id;
  if (!id || !model) return null;
  const displayName = readString(raw.displayName) ?? model;
  return {
    id,
    model,
    displayName,
    description: readString(raw.description) ?? '',
    hidden: raw.hidden === true,
    isDefault: raw.isDefault === true,
    supportedReasoningEfforts: Array.isArray(raw.supportedReasoningEfforts)
      ? raw.supportedReasoningEfforts.map(normalizeReasoningOption).filter((option) => option.reasoningEffort)
      : [],
    defaultReasoningEffort: readString(raw.defaultReasoningEffort) ?? 'medium',
    serviceTiers: Array.isArray(raw.serviceTiers)
      ? raw.serviceTiers.map(normalizeServiceTier).filter((tier) => tier.id)
      : [],
    defaultServiceTier: readString(raw.defaultServiceTier),
  };
}

function normalizeReasoningOption(value: unknown): CodexModel['supportedReasoningEfforts'][number] {
  if (!value || typeof value !== 'object') return { reasoningEffort: '', description: '' };
  const raw = value as Record<string, unknown>;
  return {
    reasoningEffort: readString(raw.reasoningEffort) ?? '',
    description: readString(raw.description) ?? '',
  };
}

function normalizeServiceTier(value: unknown): CodexModel['serviceTiers'][number] {
  if (!value || typeof value !== 'object') return { id: '', name: '', description: '' };
  const raw = value as Record<string, unknown>;
  const id = readString(raw.id) ?? '';
  return {
    id,
    name: readString(raw.name) ?? id,
    description: readString(raw.description) ?? '',
  };
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  throw new Error(`Invalid ${label}`);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNestedString(value: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return readString(current);
}

function findSingleActiveTurn(turns: Map<string, ActiveTurn>): ActiveTurn | undefined {
  return turns.size === 1 ? Array.from(turns.values())[0] : undefined;
}
