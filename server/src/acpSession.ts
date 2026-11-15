import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ContentBlock,
  type PermissionOption,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type StopReason,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type { TerminalState, ThreadEvent } from '../../shared/protocol.js';
import type { ProviderSpec } from '../../shared/protocol.js';
import { Terminals } from './terminals.js';
import { Workspace } from './workspace.js';

export interface SessionHooks {
  emit(event: ThreadEvent): void;
  /** Agent is waiting on the user (true) or working again (false). */
  waiting(waiting: boolean): void;
  terminal(t: TerminalState): void;
  /** The agent process ended outside of dispose(). */
  crashed(message: string): void;
}

const STDERR_TAIL = 40;

/** One ACP agent process and session, bound to one thread and its working directory. */
export class AcpSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private conn: ClientConnection | null = null;
  private sessionId: string | null = null;
  private stderr: string[] = [];
  private disposed = false;
  private permissions = new Map<string, (optionId: string | null) => void>();
  private options: SessionConfigOption[] | null = null;
  private name: string | null = null;
  readonly workspace: Workspace;
  readonly terminals: Terminals;

  constructor(
    private spec: ProviderSpec,
    private cwd: string,
    private hooks: SessionHooks,
    private clientVersion: string,
  ) {
    this.workspace = new Workspace(cwd);
    this.terminals = new Terminals(
      (t) => hooks.terminal(t),
      (t) => hooks.emit({ kind: 'terminal_snapshot', terminalId: t.terminalId, command: t.command, output: t.output, truncated: t.truncated, exitCode: t.exitCode, signal: t.signal }),
    );
  }

  get started(): boolean {
    return this.sessionId !== null;
  }

  /** Config selectors the agent advertised for this session (model, mode…). */
  get configOptions(): SessionConfigOption[] | null {
    return this.options;
  }

  /** The agent's own name, from its initialize response. */
  get agentName(): string | null {
    return this.name;
  }

  async start(): Promise<void> {
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr.push(...chunk.split('\n').filter(Boolean));
      if (this.stderr.length > STDERR_TAIL) this.stderr.splice(0, this.stderr.length - STDERR_TAIL);
    });
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.once('exit', (code, signal) => {
      this.resolveAllPermissions();
      if (!this.disposed) this.hooks.crashed(this.describeExit(code, signal));
    });
    await spawned;

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const app = client()
      .onNotification('session/update', ({ params }) => {
        if (params.sessionId === this.sessionId) this.hooks.emit({ kind: 'acp_update', update: params.update });
      })
      .onRequest('session/request_permission', ({ params, signal }) => this.requestPermission(params.toolCall, params.options, signal))
      .onRequest('fs/read_text_file', async ({ params }) => ({
        content: await this.workspace.readText(params.path, params.line, params.limit),
      }))
      .onRequest('fs/write_text_file', async ({ params }) => {
        await this.workspace.writeText(params.path, params.content);
        return {};
      })
      .onRequest('terminal/create', async ({ params }) => {
        const cwd = params.cwd ? await this.workspace.resolve(params.cwd) : this.cwd;
        const env = Object.fromEntries((params.env ?? []).map((e) => [e.name, e.value]));
        const terminalId = this.terminals.create({ command: params.command, args: params.args ?? [], cwd, env, outputByteLimit: params.outputByteLimit });
        return { terminalId };
      })
      .onRequest('terminal/output', ({ params }) => this.terminals.output(params.terminalId))
      .onRequest('terminal/wait_for_exit', ({ params }) => this.terminals.waitForExit(params.terminalId))
      .onRequest('terminal/kill', ({ params }) => {
        this.terminals.kill(params.terminalId);
        return {};
      })
      .onRequest('terminal/release', ({ params }) => {
        const final = this.terminals.release(params.terminalId);
        if (final?.running) {
          this.hooks.emit({ kind: 'terminal_snapshot', terminalId: final.terminalId, command: final.command, output: final.output, truncated: final.truncated, exitCode: null, signal: 'SIGKILL' });
        }
        return {};
      });

    this.conn = app.connect(stream);
    const agent = this.conn.agent;

    const init = await agent.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'differ', title: 'differ', version: this.clientVersion },
    });

    const session = await agent.request('session/new', { cwd: this.cwd, mcpServers: [] });
    this.sessionId = session.sessionId;
    this.options = session.configOptions ?? null;
    this.name = init.agentInfo?.title ?? init.agentInfo?.name ?? this.spec.name;
    this.hooks.emit({
      kind: 'session_started',
      acpSessionId: session.sessionId,
      modes: session.modes ?? null,
      configOptions: this.options,
      agentName: this.name,
    });
  }

  /** Change a session config option (e.g. the model) and report the new options. */
  async setConfig(configId: string, value: string): Promise<void> {
    if (!this.conn || !this.sessionId) throw new Error('Agent session is not started');
    const res = await this.conn.agent.request('session/set_config_option', { sessionId: this.sessionId, configId, value });
    this.options = res.configOptions ?? this.options;
    this.hooks.emit({ kind: 'acp_update', update: { sessionUpdate: 'config_option_update', configOptions: this.options ?? [] } });
  }

  async prompt(content: ContentBlock[]): Promise<StopReason> {
    if (!this.conn || !this.sessionId) throw new Error('Agent session is not started');
    const res = await this.conn.agent.request('session/prompt', { sessionId: this.sessionId, prompt: content });
    return res.stopReason;
  }

  /** Ask the agent to stop the current turn. Pending permission requests are answered "cancelled". */
  async cancel(): Promise<void> {
    this.resolveAllPermissions();
    if (this.conn && this.sessionId) await this.conn.agent.notify('session/cancel', { sessionId: this.sessionId });
  }

  respondPermission(requestId: string, optionId: string | null): boolean {
    const resolve = this.permissions.get(requestId);
    if (!resolve) return false;
    resolve(optionId);
    return true;
  }

  private requestPermission(toolCall: ToolCallUpdate, options: PermissionOption[], signal: AbortSignal): Promise<RequestPermissionResponse> {
    const requestId = randomUUID();
    this.hooks.emit({ kind: 'permission_request', requestId, toolCall, options });
    this.hooks.waiting(true);
    return new Promise((resolve) => {
      const finish = (optionId: string | null) => {
        if (!this.permissions.delete(requestId)) return;
        signal.removeEventListener('abort', onAbort);
        this.hooks.emit({ kind: 'permission_resolved', requestId, optionId });
        if (this.permissions.size === 0) this.hooks.waiting(false);
        resolve({ outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } });
      };
      const onAbort = () => finish(null);
      signal.addEventListener('abort', onAbort, { once: true });
      this.permissions.set(requestId, finish);
    });
  }

  private resolveAllPermissions() {
    for (const finish of [...this.permissions.values()]) finish(null);
  }

  private describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    const how = signal ? `was killed (${signal})` : `exited with code ${code}`;
    const tail = this.stderr.slice(-8).join('\n');
    return `${this.spec.name} ${how}.${tail ? `\n${tail}` : ''}`;
  }

  /** Last lines the agent wrote to stderr; useful in error messages. */
  stderrTail(lines = 8): string {
    return this.stderr.slice(-lines).join('\n');
  }

  dispose(): void {
    this.disposed = true;
    this.resolveAllPermissions();
    this.terminals.disposeAll();
    this.conn?.close();
    if (this.child && this.child.exitCode === null) this.child.kill('SIGTERM');
  }
}
