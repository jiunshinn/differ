import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  reduceThread,
  type Method,
  type ParamsOf,
  type Push,
  type ResultOf,
  type ServerEndpoint,
  type ServerMessage,
  type ThreadEventRecord,
  type ThreadSummary,
} from '../../shared/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverMain = path.join(here, '..', 'src', 'main.js');
const mockAgent = path.join(here, 'mockAgent.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'differ-test-'));
const dataDir = path.join(tmp, 'data');
const work = path.join(tmp, 'work');
fs.mkdirSync(work, { recursive: true });

function startServer(): Promise<{ proc: ChildProcess; endpoint: ServerEndpoint }> {
  const proc = spawn(process.execPath, [serverMain], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DIFFER_DATA_DIR: dataDir,
      DIFFER_AGENTS: JSON.stringify([{ id: 'mock', name: 'Mock', command: process.execPath, args: [mockAgent], env: { ELECTRON_RUN_AS_NODE: '1' } }]),
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout!.on('data', (d) => {
      buf += d;
      const m = buf.match(/DIFFER_READY (.+)\n/);
      if (m) resolve({ proc, endpoint: JSON.parse(m[1]) });
    });
    proc.once('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

class Client {
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  pushes: Push[] = [];
  private waiters: { pred: (p: Push) => boolean; resolve: (p: Push) => void }[] = [];

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.type === 'res') {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error.message));
      } else {
        this.pushes.push(msg);
        this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
      }
    });
  }

  static connect(endpoint: ServerEndpoint, token = endpoint.token): Promise<Client> {
    const ws = new WebSocket(`${endpoint.url}/?token=${encodeURIComponent(token)}`);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(new Client(ws)));
      ws.addEventListener('error', () => reject(new Error('connect failed')));
    });
  }

  call<M extends Method>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
  }

  waitFor(pred: (p: Push) => boolean, timeoutMs = 15000): Promise<Push> {
    const hit = this.pushes.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for push')), timeoutMs);
      this.waiters.push({ pred, resolve: (p) => (clearTimeout(t), resolve(p)) });
    });
  }

  events(threadId: string): ThreadEventRecord[] {
    return this.pushes.flatMap((p) => (p.push === 'event' && p.record.threadId === threadId ? [p.record] : []));
  }

  turnEnded(threadId: string) {
    return this.waitFor((p) => p.push === 'event' && p.record.threadId === threadId && (p.record.event.kind === 'turn_end' || p.record.event.kind === 'error'));
  }

  close() {
    this.ws.close();
  }
}

let server: { proc: ChildProcess; endpoint: ServerEndpoint };
let c: Client;

/** Create a thread and subscribe before the agent can emit anything we'd miss. */
async function startThread(text: string): Promise<ThreadSummary> {
  const thread = await c.call('thread.create', { providerId: 'mock', cwd: work, text });
  await c.call('thread.subscribe', { threadId: thread.id });
  return thread;
}

before(async () => {
  server = await startServer();
  c = await Client.connect(server.endpoint);
});

after(() => {
  c?.close();
  server?.proc.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rejects a wrong token', async () => {
  await assert.rejects(Client.connect(server.endpoint, 'wrong'));
});

test('hello lists the configured providers', async () => {
  const hello = await c.call('hello', { client: 'test' });
  const mock = hello.providers.find((p) => p.id === 'mock');
  assert.ok(mock?.available);
  assert.equal(mock?.source, 'env');
  // Claude Code ships as a built-in when the adapter is installed.
  const claude = hello.providers.find((p) => p.id === 'claude-code');
  if (claude) assert.equal(claude.source, 'builtin');
});

test('streams a simple reply', async () => {
  const thread = await startThread('hello');
  await c.turnEnded(thread.id);
  const { events } = await c.call('thread.subscribe', { threadId: thread.id });
  const view = reduceThread(events);
  assert.deepEqual(
    view.items.filter((i) => i.type === 'user' || i.type === 'agent').map((i) => ('text' in i ? i.text : '')),
    ['hello', 'Hi there'],
  );
  assert.equal(view.agentName, 'Mock Agent');
  const final = await c.waitFor((p) => p.push === 'thread' && p.thread.id === thread.id && p.thread.status === 'idle');
  assert.equal(final.push === 'thread' && final.thread.title, 'hello');
});

test('full scenario: permission, fs sandbox, terminal, usage, title', async () => {
  const thread = await startThread('scenario');
  const ask = await c.waitFor((p) => p.push === 'event' && p.record.threadId === thread.id && p.record.event.kind === 'permission_request');
  await c.waitFor((p) => p.push === 'thread' && p.thread.id === thread.id && p.thread.status === 'waiting');
  assert.ok(ask.push === 'event' && ask.record.event.kind === 'permission_request');
  await c.call('thread.respondPermission', { threadId: thread.id, requestId: ask.record.event.requestId, optionId: 'allow' });
  await c.turnEnded(thread.id);

  assert.equal(fs.readFileSync(path.join(work, 'out.txt'), 'utf8'), 'hello from mock\n');
  assert.equal(fs.existsSync(path.join(tmp, 'escape.txt')), false, 'write outside the folder must be blocked');

  const { events, thread: after } = await c.call('thread.subscribe', { threadId: thread.id });
  const view = reduceThread(events);
  const tools = Object.fromEntries(view.items.flatMap((i) => (i.type === 'tool' ? [[i.tool.toolCallId, i.tool]] : [])));
  assert.equal(tools['edit-1'].status, 'completed');
  assert.equal(tools['edit-1'].content[0].type, 'diff');
  assert.equal(tools['run-1'].status, 'completed');
  const term = tools['run-1'].content[0];
  assert.ok(term.type === 'terminal');
  assert.equal(view.terminals[term.terminalId]?.output.trim(), 'term ok');
  assert.equal(view.terminals[term.terminalId]?.exitCode, 0);
  assert.deepEqual(view.usage, { used: 84000, size: 200000 });
  assert.equal(view.plan?.length, 2);
  assert.ok(view.items.some((i) => i.type === 'thought'));
  assert.ok(view.items.some((i) => i.type === 'permission' && i.resolved && i.optionId === 'allow'));
  assert.equal(view.pendingPermissions.length, 0);
  const lastAgent = view.items.filter((i) => i.type === 'agent').at(-1);
  assert.match(lastAgent && 'text' in lastAgent ? lastAgent.text : '', /escape blocked/);
  assert.match(lastAgent && 'text' in lastAgent ? lastAgent.text : '', /term=\\?"term ok/);
  assert.equal(after.title, 'Mock scenario');
  assert.equal(after.status, 'idle');
});

test('rejecting a permission stops the edit', async () => {
  fs.rmSync(path.join(work, 'out.txt'), { force: true });
  const thread = await startThread('scenario');
  const ask = await c.waitFor((p) => p.push === 'event' && p.record.threadId === thread.id && p.record.event.kind === 'permission_request');
  assert.ok(ask.push === 'event' && ask.record.event.kind === 'permission_request');
  await c.call('thread.respondPermission', { threadId: thread.id, requestId: ask.record.event.requestId, optionId: 'reject' });
  await c.turnEnded(thread.id);
  assert.equal(fs.existsSync(path.join(work, 'out.txt')), false);
  const view = reduceThread(c.events(thread.id));
  const edit = view.items.find((i) => i.type === 'tool' && i.tool.toolCallId === 'edit-1');
  assert.ok(edit?.type === 'tool' && edit.tool.status === 'failed');
});

test('cancel stops a running turn', async () => {
  const thread = await startThread('wait');
  await c.waitFor((p) => p.push === 'thread' && p.thread.id === thread.id && p.thread.status === 'running');
  await assert.rejects(c.call('thread.prompt', { threadId: thread.id, text: 'again' }), /still working/);
  await c.call('thread.cancel', { threadId: thread.id });
  const end = await c.turnEnded(thread.id);
  assert.ok(end.push === 'event' && end.record.event.kind === 'turn_end' && end.record.event.stopReason === 'cancelled');
  // The thread accepts a new prompt afterwards, on the same agent session.
  await c.waitFor((p) => p.push === 'thread' && p.thread.id === thread.id && p.thread.status === 'idle');
  await c.call('thread.prompt', { threadId: thread.id, text: 'hello' });
  await c.waitFor((p) => p.push === 'event' && p.record.threadId === thread.id && p.record.event.kind === 'turn_end' && p.record.event.stopReason === 'end_turn');
  assert.equal(c.events(thread.id).filter((r) => r.event.kind === 'session_started').length, 1);
});

test('rejects bad input with a clear message', async () => {
  await assert.rejects(c.call('thread.create', { providerId: 'mock', cwd: path.join(tmp, 'missing'), text: 'hi' }), /Folder not found/);
  await assert.rejects(c.call('thread.create', { providerId: 'nope', cwd: work, text: 'hi' }), /Unknown provider/);
  await assert.rejects(c.call('thread.create', { providerId: 'mock', cwd: work, text: '   ' }), /Write a message/);
});

test('providers can be added, used, and removed', async () => {
  const spec = { id: 'mock-2', name: 'Mock 2', description: 'second copy', command: process.execPath, args: [mockAgent], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const saved = await c.call('providers.save', { provider: spec });
  assert.equal(saved.source, 'file');
  assert.ok(saved.available);
  assert.deepEqual(await c.call('providers.list', {}).then((l) => l.map((p) => p.id)).then((ids) => ids.includes('mock-2')), true);

  // A thread can immediately use the new provider.
  const thread = await c.call('thread.create', { providerId: 'mock-2', cwd: work, text: 'hello' });
  await c.call('thread.subscribe', { threadId: thread.id });
  await c.waitFor((p) => p.push === 'event' && p.record.threadId === thread.id && p.record.event.kind === 'turn_end');

  await assert.rejects(c.call('providers.save', { provider: { ...spec, id: 'Bad ID' } }), /lowercase letters/);
  await assert.rejects(c.call('providers.save', { provider: { ...spec, name: '' } }), /name/);
  await assert.rejects(c.call('providers.save', { provider: { ...spec, id: 'claude-code' } }), /built in/);
  await assert.rejects(c.call('providers.delete', { id: 'mock' }), /can’t be removed/);
  await c.call('providers.delete', { id: 'mock-2' });
  assert.equal((await c.call('providers.list', {})).some((p) => p.id === 'mock-2'), false);
  // Gone from disk too, so it won't come back after a restart.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'agents.json'), 'utf8')) as { id: string }[];
  assert.equal(onDisk.some((p) => p.id === 'mock-2'), false);
});

test('models can be picked before a thread starts, and changed after', async () => {
  // The agent only reveals its model selector once a session exists.
  const probe = await c.call('providers.models', { providerId: 'mock', cwd: work });
  assert.equal(probe.selector?.configId, 'model');
  assert.deepEqual(probe.selector?.choices.map((m) => m.value), ['fast', 'deep']);

  const thread = await c.call('thread.create', { providerId: 'mock', cwd: work, text: 'model', model: { configId: 'model', value: 'deep' } });
  await c.call('thread.subscribe', { threadId: thread.id });
  await c.turnEnded(thread.id);

  const view = reduceThread(c.events(thread.id));
  const said = view.items.filter((i) => i.type === 'agent').at(-1);
  assert.match(said && 'text' in said ? said.text : '', /model=deep/);
  const option = view.configOptions?.find((o) => o.id === 'model');
  assert.equal(option?.type === 'select' ? option.currentValue : null, 'deep');

  // Switching mid-thread applies to the next turn, on the same session.
  const lastSeq = c.events(thread.id).at(-1)?.seq ?? 0;
  await c.call('thread.setConfig', { threadId: thread.id, configId: 'model', value: 'fast' });
  await c.call('thread.prompt', { threadId: thread.id, text: 'model' });
  await c.waitFor((p) => p.push === 'event' && p.record.threadId === thread.id && p.record.seq > lastSeq && p.record.event.kind === 'turn_end');
  const after = reduceThread(c.events(thread.id));
  const replied = after.items.filter((i) => i.type === 'agent').at(-1);
  assert.match(replied && 'text' in replied ? replied.text : '', /model=fast/);
});

test('models can be hidden per provider', async () => {
  assert.deepEqual(await c.call('models.prefs', {}), {});
  const saved = await c.call('models.savePrefs', { providerId: 'mock', disabled: ['deep', 'deep', ''] });
  assert.deepEqual(saved.mock, ['deep'], 'duplicates and blanks are dropped');

  // The composer gets the full selector plus what to hide.
  const models = await c.call('providers.models', { providerId: 'mock', cwd: work });
  assert.deepEqual(models.disabled, ['deep']);
  assert.deepEqual(models.selector?.choices.map((m) => m.value), ['fast', 'deep']);

  // Written next to agents.json so it survives a restart.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'models.json'), 'utf8')) as Record<string, string[]>;
  assert.deepEqual(onDisk, { mock: ['deep'] });

  await c.call('models.savePrefs', { providerId: 'mock', disabled: [] });
  assert.deepEqual(await c.call('models.prefs', {}), {});
  await assert.rejects(c.call('models.savePrefs', { providerId: 'nope', disabled: [] }), /Unknown provider/);
});

test('threads and events survive a restart', async () => {
  const before = await c.call('threads.list', {});
  c.close();
  server.proc.kill();
  await new Promise((r) => server.proc.once('exit', r));
  server = await startServer();
  c = await Client.connect(server.endpoint);
  const afterList = await c.call('threads.list', {});
  assert.deepEqual(afterList.map((t) => t.id).sort(), before.map((t) => t.id).sort());
  assert.ok(afterList.every((t) => t.status === 'idle' || t.status === 'failed'));
  const scenario = afterList.find((t) => t.title === 'Mock scenario')!;
  const { events } = await c.call('thread.subscribe', { threadId: scenario.id });
  assert.ok(reduceThread(events).items.length > 5);
});

test('serves the same protocol over stdio', async () => {
  const proc = spawn(process.execPath, [serverMain, '--stdio'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DIFFER_DATA_DIR: dataDir, DIFFER_AGENTS: '[]' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines: string[] = [];
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d: string) => lines.push(...d.split('\n').filter(Boolean)));
  const call = (method: string, params: unknown, id: number) => proc.stdin.write(`${JSON.stringify({ type: 'req', id, method, params })}\n`);

  call('hello', { client: 'test' }, 1);
  call('providers.list', {}, 2);
  call('threads.list', {}, 3);
  const waitFor = async (id: number) => {
    for (let i = 0; i < 200; i++) {
      const hit = lines.map((l) => JSON.parse(l) as ServerMessage).find((m) => m.type === 'res' && m.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no reply to ${id}`);
  };
  const hello = await waitFor(1);
  assert.ok(hello.type === 'res' && hello.ok);
  assert.equal((hello.result as { protocol: number }).protocol, 1);
  const providers = await waitFor(2);
  assert.ok(providers.type === 'res' && providers.ok && Array.isArray(providers.result));
  const threads = await waitFor(3);
  assert.ok(threads.type === 'res' && threads.ok && Array.isArray(threads.result));
  // Nothing but protocol messages on stdout.
  assert.ok(lines.every((l) => (JSON.parse(l) as ServerMessage).type === 'res' || (JSON.parse(l) as { type: string }).type === 'push'));

  proc.stdin.end();
  await new Promise((r) => proc.once('exit', r));
});
