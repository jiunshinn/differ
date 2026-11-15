import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { getDb, stmt } from './db';
import { sendCodexTurn, startCodexThread } from './codexAppServer';
import { getRepositoryById } from './repoStore';
import type {
  AgentKind,
  AgentSession,
  AgentSideChatMessage,
  CreateAgentSideChatMessageInput,
  CreateAgentSessionInput,
  LaunchAgentSessionInput,
  TmuxPane,
  UpdateAgentSessionPatch,
} from '../../shared/types';

const TMUX_FORMAT = [
  '#{session_name}',
  '#{window_index}',
  '#{pane_index}',
  '#{pane_id}',
  '#{pane_current_command}',
  '#{pane_active}',
  '#{pane_current_path}',
  '#{pane_title}',
].join('\t');

export function listAgentSessions(repoId: number): AgentSession[] {
  return stmt(
    `SELECT * FROM agent_sessions
      WHERE repository_id = ?
      ORDER BY updated_at DESC, id DESC`,
  ).all(repoId) as AgentSession[];
}

export function createAgentSession(input: CreateAgentSessionInput): AgentSession {
  validateAgentKind(input.agent_kind);
  const title = requireText(input.title, 'Session title');
  const objective = requireText(input.objective, 'Objective');
  const tmuxSession = requireText(input.tmux_session, 'tmux session');
  const tmuxWindow = requireText(input.tmux_window, 'tmux window');
  const tmuxPane = requireText(input.tmux_pane, 'tmux pane');
  const worktreePath = input.worktree_path?.trim() || null;
  const codexThreadId = input.codex_thread_id?.trim() || null;
  const codexModel = input.codex_model?.trim() || null;
  const codexEffort = input.codex_effort?.trim() || null;
  const codexServiceTier = input.codex_service_tier?.trim() || null;
  const result = stmt(
    `INSERT INTO agent_sessions
      (repository_id, title, objective, agent_kind, worktree_path, codex_thread_id, codex_model, codex_effort, codex_service_tier, tmux_session, tmux_window, tmux_pane, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`,
  ).run(
    input.repository_id,
    title,
    objective,
    input.agent_kind,
    worktreePath,
    codexThreadId,
    codexModel,
    codexEffort,
    codexServiceTier,
    tmuxSession,
    tmuxWindow,
    tmuxPane,
  );
  return mustAgentSession(Number(result.lastInsertRowid));
}

export async function launchAgentSession(
  input: LaunchAgentSessionInput,
  commandOverride?: string,
): Promise<AgentSession> {
  validateAgentKind(input.agent_kind);
  const repo = getRepositoryById(input.repository_id);
  if (!repo) throw new Error('Repository not found');
  const title = requireText(input.title, 'Session title');
  const objective = requireText(input.objective, 'Objective');
  const cwd = input.worktree_path?.trim() || repo.path;
  if (!fs.existsSync(cwd)) throw new Error(`Session directory does not exist: ${cwd}`);
  if (input.agent_kind === 'codex') {
    const codexModel = input.codex_model?.trim() || null;
    const codexEffort = input.codex_effort?.trim() || null;
    const codexServiceTier = input.codex_service_tier?.trim() || null;
    const threadId = await startCodexThread(cwd, {
      model: codexModel,
      effort: codexEffort,
      serviceTier: codexServiceTier,
    });
    return createAgentSession({
      repository_id: input.repository_id,
      title,
      objective,
      agent_kind: input.agent_kind,
      worktree_path: input.worktree_path ?? null,
      codex_thread_id: threadId,
      codex_model: codexModel,
      codex_effort: codexEffort,
      codex_service_tier: codexServiceTier,
      tmux_session: 'codex-app-server',
      tmux_window: 'thread',
      tmux_pane: threadId,
    });
  }
  const sessionName = uniqueTmuxSessionName(repo.name, input.agent_kind);
  const command = commandOverride ?? commandForKind(input.agent_kind);
  const args = ['new-session', '-d', '-s', sessionName, '-c', cwd];
  if (command) args.push(command);
  await runTmux(args);
  return createAgentSession({
    repository_id: input.repository_id,
    title,
    objective,
    agent_kind: input.agent_kind,
    worktree_path: input.worktree_path ?? null,
    tmux_session: sessionName,
    tmux_window: '0',
    tmux_pane: '0',
  });
}

export function updateAgentSession(id: number, patch: UpdateAgentSessionPatch): AgentSession | null {
  const existing = getAgentSession(id);
  if (!existing) return null;
  const next = {
    title: patch.title === undefined ? existing.title : requireText(patch.title, 'Session title'),
    objective:
      patch.objective === undefined ? existing.objective : requireText(patch.objective, 'Objective'),
    status: patch.status ?? existing.status,
    last_output: patch.last_output === undefined ? existing.last_output : patch.last_output,
    codex_model:
      patch.codex_model === undefined ? existing.codex_model : patch.codex_model?.trim() || null,
    codex_effort:
      patch.codex_effort === undefined ? existing.codex_effort : patch.codex_effort?.trim() || null,
    codex_service_tier:
      patch.codex_service_tier === undefined
        ? existing.codex_service_tier
        : patch.codex_service_tier?.trim() || null,
  };
  if (!['running', 'idle', 'stopped', 'unknown'].includes(next.status)) {
    throw new Error(`Invalid agent session status: ${next.status}`);
  }
  stmt(
    `UPDATE agent_sessions
      SET title = ?, objective = ?, status = ?, last_output = ?, codex_model = ?, codex_effort = ?, codex_service_tier = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    next.title,
    next.objective,
    next.status,
    next.last_output,
    next.codex_model,
    next.codex_effort,
    next.codex_service_tier,
    id,
  );
  return getAgentSession(id);
}

export function deleteAgentSession(id: number): void {
  stmt(`DELETE FROM agent_sessions WHERE id = ?`).run(id);
}

export function getAgentSession(id: number): AgentSession | null {
  return (stmt(`SELECT * FROM agent_sessions WHERE id = ?`).get(id) as AgentSession | undefined) ?? null;
}

export async function listTmuxPanes(): Promise<TmuxPane[]> {
  let output = '';
  try {
    output = await runTmux(['list-panes', '-a', '-F', TMUX_FORMAT]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no server running|failed to connect|server exited/i.test(message)) return [];
    throw err;
  }
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseTmuxPane);
}

export async function captureAgentSession(id: number): Promise<AgentSession> {
  const session = mustAgentSession(id);
  if (session.agent_kind === 'codex') {
    return updateAgentSession(id, {
      status: session.codex_thread_id ? 'idle' : 'unknown',
      last_output: session.last_output,
    })!;
  }
  const output = await capturePane(session);
  return updateAgentSession(id, {
    status: output.trim() ? 'running' : 'unknown',
    last_output: output,
  })!;
}

export async function sendAgentPrompt(id: number, text: string): Promise<AgentSession> {
  const session = mustAgentSession(id);
  const prompt = requireText(text, 'Prompt');
  if (session.agent_kind === 'codex') {
    const repo = getRepositoryById(session.repository_id);
    if (!repo) throw new Error('Repository not found');
    let threadId = session.codex_thread_id;
    if (!threadId) {
      threadId = await startCodexThread(session.worktree_path || repo.path, {
        model: session.codex_model,
        effort: session.codex_effort,
        serviceTier: session.codex_service_tier,
      });
      stmt(`UPDATE agent_sessions SET codex_thread_id = ?, updated_at = datetime('now') WHERE id = ?`).run(threadId, id);
    }
    const userMessage = insertSideChatMessage(session.id, 'user', prompt, true);
    const output = await sendCodexTurn(threadId, prompt, {
      model: session.codex_model,
      effort: session.codex_effort,
      serviceTier: session.codex_service_tier,
    });
    insertSideChatMessage(session.id, 'agent', output, false);
    updateAgentSession(id, {
      status: 'idle',
      last_output: output,
    });
    return getAgentSession(userMessage.agent_session_id)!;
  }
  const target = tmuxTarget(session);
  await runTmux(['send-keys', '-t', target, '-l', prompt]);
  await runTmux(['send-keys', '-t', target, 'Enter']);
  return captureAgentSession(id);
}

export function listAgentSideChat(sessionId: number): AgentSideChatMessage[] {
  mustAgentSession(sessionId);
  return stmt(
    `SELECT * FROM agent_side_chat_messages
      WHERE agent_session_id = ?
      ORDER BY id ASC`,
  ).all(sessionId) as AgentSideChatMessage[];
}

export async function createAgentSideChatMessage(
  input: CreateAgentSideChatMessageInput,
): Promise<AgentSideChatMessage> {
  const session = mustAgentSession(input.agent_session_id);
  validateSideChatRole(input.role);
  const body = requireText(input.body, 'Side chat message');
  const sendToAgent = input.send_to_agent === true && input.role === 'user';
  if (sendToAgent && session.agent_kind === 'codex') {
    await sendAgentPrompt(session.id, body);
    const latest = stmt(
      `SELECT * FROM agent_side_chat_messages
        WHERE agent_session_id = ? AND role = 'user'
        ORDER BY id DESC LIMIT 1`,
    ).get(session.id) as AgentSideChatMessage | undefined;
    if (!latest) throw new Error('Side chat message not found');
    return latest;
  }
  if (sendToAgent) {
    await sendAgentPrompt(session.id, body);
  }
  return insertSideChatMessage(session.id, input.role, body, sendToAgent);
}

export function deleteAgentSideChatMessage(id: number): void {
  stmt(`DELETE FROM agent_side_chat_messages WHERE id = ?`).run(id);
}

function mustAgentSideChatMessage(id: number): AgentSideChatMessage {
  const message = stmt(`SELECT * FROM agent_side_chat_messages WHERE id = ?`).get(id) as
    | AgentSideChatMessage
    | undefined;
  if (!message) throw new Error('Side chat message not found');
  return message;
}

function insertSideChatMessage(
  sessionId: number,
  role: CreateAgentSideChatMessageInput['role'],
  body: string,
  sentToAgent: boolean,
): AgentSideChatMessage {
  const result = stmt(
    `INSERT INTO agent_side_chat_messages
      (agent_session_id, role, body, sent_to_agent)
      VALUES (?, ?, ?, ?)`,
  ).run(sessionId, role, body, sentToAgent ? 1 : 0);
  return mustAgentSideChatMessage(Number(result.lastInsertRowid));
}

function mustAgentSession(id: number): AgentSession {
  const session = getAgentSession(id);
  if (!session) throw new Error('Agent session not found');
  return session;
}

async function capturePane(session: AgentSession): Promise<string> {
  return runTmux(['capture-pane', '-p', '-S', '-240', '-t', tmuxTarget(session)]);
}

function parseTmuxPane(line: string): TmuxPane {
  const [session, window, paneIndex, paneId, command, active, currentPath, title] = line.split('\t');
  const pane = paneId || paneIndex || '0';
  return {
    session: session ?? '',
    window: window ?? '0',
    pane,
    target: paneId || `${session}:${window}.${paneIndex}`,
    command: command ?? '',
    active: active === '1',
    currentPath: currentPath ?? '',
    title: title ?? '',
  };
}

function tmuxTarget(session: AgentSession): string {
  if (session.tmux_pane.startsWith('%')) return session.tmux_pane;
  return `${session.tmux_session}:${session.tmux_window}.${session.tmux_pane}`;
}

function commandForKind(kind: AgentKind): string | null {
  if (kind === 'codex') return 'codex';
  // Claude Code must stay in its interactive terminal flow. Do not replace this
  // with `claude -p` or other programmatic modes; those can bill API usage
  // instead of using the user's Claude Code subscription.
  if (kind === 'claude') return 'claude';
  if (kind === 'opencode') return 'opencode';
  return null;
}

function uniqueTmuxSessionName(repoName: string, kind: AgentKind): string {
  const safeRepo = repoName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'repo';
  return `differ-${kind}-${safeRepo}-${Date.now().toString(36)}`;
}

function validateAgentKind(kind: string): asserts kind is AgentKind {
  if (kind !== 'codex' && kind !== 'claude' && kind !== 'opencode' && kind !== 'terminal') {
    throw new Error(`Invalid agent kind: ${kind}`);
  }
}

function validateSideChatRole(role: string): asserts role is CreateAgentSideChatMessageInput['role'] {
  if (role !== 'user' && role !== 'agent' && role !== 'note') {
    throw new Error(`Invalid side chat role: ${role}`);
  }
}

function requireText(value: string, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function runTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('tmux is not installed or is not available on PATH'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `tmux exited with code ${code}`));
    });
  });
}

export function pruneAgentSessionsForMissingRepo(repoId: number): void {
  getDb().prepare(`DELETE FROM agent_sessions WHERE repository_id = ?`).run(repoId);
}
