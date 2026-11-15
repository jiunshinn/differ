import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { TerminalState } from '../../shared/protocol.js';

const DEFAULT_LIMIT = 1024 * 1024;

interface Entry {
  state: TerminalState;
  buf: Buffer;
  limit: number;
  child: ChildProcess;
  exited: Promise<void>;
  flushTimer: NodeJS.Timeout | null;
}

export interface CreateOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  outputByteLimit?: number | null;
}

/** Drop bytes from the front so at most `limit` remain, without splitting a UTF-8 character. */
function trimToLimit(buf: Buffer, limit: number): { buf: Buffer; truncated: boolean } {
  if (buf.length <= limit) return { buf, truncated: false };
  let start = buf.length - limit;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return { buf: buf.subarray(start), truncated: true };
}

/** Commands run on behalf of one thread's agent (ACP terminal/*). */
export class Terminals {
  private entries = new Map<string, Entry>();

  /** onChange is called (throttled) with the latest state; onExit once the process ends. */
  constructor(
    private onChange: (t: TerminalState) => void,
    private onExit: (t: TerminalState) => void,
  ) {}

  create(opts: CreateOptions): string {
    const terminalId = `term_${randomUUID()}`;
    const display = [opts.command, ...opts.args].join(' ');
    // Agents normally pass command + args. A bare command line with no args is run through the shell.
    const child =
      opts.args.length === 0 && /\s/.test(opts.command)
        ? spawn(opts.command, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, shell: true })
        : spawn(opts.command, opts.args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });

    const entry: Entry = {
      state: { terminalId, command: display, output: '', truncated: false, exitCode: null, signal: null, running: true },
      buf: Buffer.alloc(0),
      limit: opts.outputByteLimit ?? DEFAULT_LIMIT,
      child,
      flushTimer: null,
      exited: new Promise<void>((resolve) => {
        const done = (code: number | null, signal: NodeJS.Signals | null) => {
          if (!entry.state.running) return;
          entry.state = { ...entry.state, exitCode: code, signal, running: false };
          this.flush(entry);
          this.onExit(entry.state);
          resolve();
        };
        child.on('exit', done);
        child.on('error', (err) => {
          this.append(entry, Buffer.from(`${err.message}\n`));
          done(127, null);
        });
      }),
    };
    const onData = (chunk: Buffer) => this.append(entry, chunk);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    this.entries.set(terminalId, entry);
    this.onChange(entry.state);
    return terminalId;
  }

  private append(entry: Entry, chunk: Buffer) {
    const { buf, truncated } = trimToLimit(Buffer.concat([entry.buf, chunk]), entry.limit);
    entry.buf = buf;
    entry.state = { ...entry.state, output: buf.toString('utf8'), truncated: entry.state.truncated || truncated };
    entry.flushTimer ??= setTimeout(() => this.flush(entry), 80);
  }

  private flush(entry: Entry) {
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
    this.onChange(entry.state);
  }

  private get(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown terminal: ${id}`);
    return e;
  }

  output(id: string) {
    const { state } = this.get(id);
    return {
      output: state.output,
      truncated: state.truncated,
      exitStatus: state.running ? null : { exitCode: state.exitCode, signal: state.signal },
    };
  }

  async waitForExit(id: string) {
    const e = this.get(id);
    await e.exited;
    return { exitCode: e.state.exitCode, signal: e.state.signal };
  }

  kill(id: string): void {
    const e = this.get(id);
    if (e.state.running) e.child.kill('SIGTERM');
  }

  /** Kill if still running and forget the terminal. Returns its final state. */
  release(id: string): TerminalState | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.state.running) e.child.kill('SIGKILL');
    if (e.flushTimer) clearTimeout(e.flushTimer);
    this.entries.delete(id);
    return e.state;
  }

  live(): TerminalState[] {
    return [...this.entries.values()].map((e) => e.state);
  }

  disposeAll(): void {
    for (const id of [...this.entries.keys()]) this.release(id);
  }
}
