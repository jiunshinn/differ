/**
 * A scripted ACP agent for tests. Speaks ACP over stdio like a real agent.
 *
 * Prompts:
 *   "hello"     streams a two-chunk reply
 *   "scenario"  plan, thought, tool calls, a permission request, fs read/write
 *               (plus an escape attempt that must be blocked), a terminal,
 *               usage and title updates
 *   "wait"      blocks until session/cancel, then stops with "cancelled"
 */
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { agent, ndJsonStream, PROTOCOL_VERSION, type AgentContext, type SessionUpdate } from '@agentclientprotocol/sdk';

const sessions = new Map<string, { cwd: string; cancel: (() => void) | null }>();
let next = 0;
/** Current model of the newest session, so tests can see set_config_option land. */
let model = 'fast';

const update = (client: AgentContext, sessionId: string, u: SessionUpdate) => client.notify('session/update', { sessionId, update: u });
const say = (client: AgentContext, sessionId: string, text: string) =>
  update(client, sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

async function scenario(client: AgentContext, sessionId: string, cwd: string) {
  await update(client, sessionId, {
    sessionUpdate: 'plan',
    entries: [
      { content: 'Write out.txt', priority: 'high', status: 'in_progress' },
      { content: 'Run a command', priority: 'medium', status: 'pending' },
    ],
  });
  await update(client, sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Need approval first.' } });

  const target = path.join(cwd, 'out.txt');
  await update(client, sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'edit-1',
    title: 'Write out.txt',
    kind: 'edit',
    status: 'pending',
    locations: [{ path: target }],
    content: [{ type: 'diff', path: target, oldText: null, newText: 'hello from mock\n' }],
  });

  const answer = await client.request('session/request_permission', {
    sessionId,
    toolCall: { toolCallId: 'edit-1', title: 'Write out.txt', kind: 'edit' },
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  });
  const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'allow';
  if (!allowed) {
    await update(client, sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'failed' });
    await say(client, sessionId, 'Permission denied.');
    return;
  }

  await client.request('fs/write_text_file', { sessionId, path: target, content: 'hello from mock\n' });
  const read = await client.request('fs/read_text_file', { sessionId, path: target });
  await update(client, sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'completed' });

  let escape = 'escape allowed';
  try {
    await client.request('fs/write_text_file', { sessionId, path: path.join(cwd, '..', 'escape.txt'), content: 'nope' });
  } catch {
    escape = 'escape blocked';
  }

  const term = await client.createTerminal({ sessionId, command: process.execPath, args: ['-e', "console.log('term ok')"], cwd, env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] });
  await update(client, sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'run-1',
    title: 'Run node',
    kind: 'execute',
    status: 'in_progress',
    content: [{ type: 'terminal', terminalId: term.id }],
  });
  const exit = await term.waitForExit();
  const out = await term.currentOutput();
  await term.release();
  await update(client, sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'run-1', status: exit.exitCode === 0 ? 'completed' : 'failed' });

  await update(client, sessionId, { sessionUpdate: 'usage_update', used: 84000, size: 200000 });
  await update(client, sessionId, { sessionUpdate: 'session_info_update', title: 'Mock scenario' });
  await say(client, sessionId, `read=${JSON.stringify(read.content)} ${escape} term=${JSON.stringify(out.output.trim())}`);
}

const app = agent()
  .onRequest('initialize', () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: 'mock-agent', title: 'Mock Agent', version: '1.0.0' },
    authMethods: [],
  }))
  .onRequest('session/new', ({ params }) => {
    const sessionId = `mock-${++next}`;
    sessions.set(sessionId, { cwd: params.cwd, cancel: null });
    model = 'fast';
    return {
      sessionId,
      configOptions: [{ id: 'model', name: 'Model', category: 'model' as const, type: 'select' as const, currentValue: model, options: [
        { value: 'fast', name: 'Fast', description: 'Quick answers' },
        { value: 'deep', name: 'Deep', description: 'Takes longer' },
      ] }],
    };
  })
  .onRequest('session/set_config_option', ({ params }) => {
    if (params.configId !== 'model') throw new Error(`unknown config: ${params.configId}`);
    if (params.value !== 'fast' && params.value !== 'deep') throw new Error(`unknown model: ${params.value}`);
    model = params.value;
    return {
      configOptions: [{ id: 'model', name: 'Model', category: 'model' as const, type: 'select' as const, currentValue: model, options: [
        { value: 'fast', name: 'Fast', description: 'Quick answers' },
        { value: 'deep', name: 'Deep', description: 'Takes longer' },
      ] }],
    };
  })
  .onNotification('session/cancel', ({ params }) => {
    sessions.get(params.sessionId)?.cancel?.();
  })
  .onRequest('session/prompt', async ({ params, client }) => {
    const s = sessions.get(params.sessionId);
    if (!s) throw new Error('unknown session');
    const text = params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (text === 'wait') {
      await new Promise<void>((resolve) => (s.cancel = resolve));
      return { stopReason: 'cancelled' as const };
    }
    if (text === 'model') {
      await say(client, params.sessionId, `model=${model}`);
      return { stopReason: 'end_turn' as const };
    }
    if (text === 'scenario') await scenario(client, params.sessionId, s.cwd);
    else {
      await say(client, params.sessionId, 'Hi ');
      await say(client, params.sessionId, 'there');
    }
    return { stopReason: 'end_turn' as const };
  });

const conn = app.connect(ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
await conn.closed;
