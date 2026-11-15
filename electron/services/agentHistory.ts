import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AgentHistoryDetail,
  AgentHistoryEntry,
  AgentHistoryProvider,
} from '../../shared/types';

const MAX_HISTORY_FILES = 500;
const MAX_PREVIEW_CHARS = 240;
const MAX_CONTEXT_CHARS = 16_000;

export async function listAgentHistory(
  repoPath: string,
  provider: AgentHistoryProvider | 'all' = 'all',
): Promise<AgentHistoryEntry[]> {
  const providers: AgentHistoryProvider[] =
    provider === 'all' ? ['codex', 'claude', 'opencode'] : [provider];
  const groups = await Promise.all(
    providers.map((p) => {
      if (p === 'codex') return listCodexHistory(repoPath);
      if (p === 'claude') return listClaudeHistory(repoPath);
      return listOpenCodeHistory(repoPath);
    }),
  );
  return groups
    .flat()
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 120);
}

export async function readAgentHistory(
  provider: AgentHistoryProvider,
  id: string,
): Promise<AgentHistoryDetail> {
  if (provider === 'opencode') return readOpenCodeHistory(id);
  const filePath = decodeHistoryId(id);
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Agent history file not found');
  if (provider === 'codex') return readJsonlHistory(provider, filePath, parseCodexRecord);
  return readJsonlHistory(provider, filePath, parseClaudeRecord);
}

async function listCodexHistory(repoPath: string): Promise<AgentHistoryEntry[]> {
  const files = historyFiles([
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
  ]);
  return files
    .map((file) => summarizeJsonl('codex', file, parseCodexRecord))
    .filter((entry): entry is AgentHistoryEntry => entry != null)
    .filter((entry) => isRepoMatch(entry.cwd, repoPath) || entry.preview.includes(repoPath));
}

async function listClaudeHistory(repoPath: string): Promise<AgentHistoryEntry[]> {
  const files = historyFiles([
    path.join(os.homedir(), '.claude', 'transcripts'),
    path.join(os.homedir(), '.claude', 'projects'),
  ]);
  const entries = files
    .map((file) => summarizeJsonl('claude', file, parseClaudeRecord))
    .filter((entry): entry is AgentHistoryEntry => entry != null);
  const repoMatches = entries.filter((entry) => isRepoMatch(entry.cwd, repoPath) || entry.preview.includes(repoPath));
  return repoMatches.length ? repoMatches : entries.slice(0, 80);
}

function listOpenCodeHistory(repoPath: string): AgentHistoryEntry[] {
  const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  if (!fs.existsSync(dbPath)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT id, title, directory, path, agent, time_updated
          FROM session
          WHERE directory = ? OR directory LIKE ? OR path = ? OR path LIKE ?
          ORDER BY time_updated DESC
          LIMIT 120`,
      )
      .all(repoPath, `${repoPath}${path.sep}%`, repoPath, `${repoPath}${path.sep}%`) as OpenCodeSessionRow[];
    return rows.map((row) => openCodeEntry(row));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function readOpenCodeHistory(id: string): AgentHistoryDetail {
  const sessionId = decodeHistoryId(id);
  const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  if (!sessionId || !fs.existsSync(dbPath)) throw new Error('OpenCode history database not found');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare(`SELECT id, title, directory, path, agent, time_updated FROM session WHERE id = ?`)
      .get(sessionId) as OpenCodeSessionRow | undefined;
    if (!row) throw new Error('OpenCode session not found');
    const messages = db
      .prepare(`SELECT data FROM message WHERE session_id = ? ORDER BY time_created, id`)
      .all(sessionId) as { data: string }[];
    const context = messages
      .map((m) => safeJson(m.data))
      .map((m, index) => formatRecordText(m, `message ${index + 1}`))
      .filter(Boolean)
      .join('\n\n');
    return {
      entry: { ...openCodeEntry(row), message_count: messages.length, preview: firstLine(context) },
      context: buildContext('opencode', row.title || row.id, context),
    };
  } finally {
    db.close();
  }
}

function summarizeJsonl(
  provider: AgentHistoryProvider,
  filePath: string,
  parser: (record: unknown) => ParsedHistoryRecord,
): AgentHistoryEntry | null {
  const stat = fs.statSync(filePath);
  let cwd: string | null = null;
  let sessionId: string | null = null;
  let messageCount = 0;
  const snippets: string[] = [];
  for (const record of readJsonl(filePath, 1200)) {
    const parsed = parser(record);
    cwd ??= parsed.cwd;
    sessionId ??= parsed.sessionId;
    if (!parsed.text) continue;
    messageCount += 1;
    if (snippets.join(' ').length < MAX_PREVIEW_CHARS * 2) snippets.push(parsed.text);
  }
  const preview = firstLine(snippets.join(' '));
  if (!preview && messageCount === 0) return null;
  return {
    id: encodeHistoryId(filePath),
    provider,
    title: titleFromFile(provider, filePath, preview),
    file_path: filePath,
    session_id: sessionId,
    cwd,
    updated_at: stat.mtime.toISOString(),
    message_count: messageCount,
    preview,
  };
}

async function readJsonlHistory(
  provider: AgentHistoryProvider,
  filePath: string,
  parser: (record: unknown) => ParsedHistoryRecord,
): Promise<AgentHistoryDetail> {
  const entry = summarizeJsonl(provider, filePath, parser);
  if (!entry) throw new Error('Could not read agent history');
  const context = readJsonl(filePath, 4000)
    .map(parser)
    .filter((record) => record.text)
    .map((record) => formatParsedRecord(record))
    .join('\n\n');
  return {
    entry,
    context: buildContext(provider, entry.title, context),
  };
}

function historyFiles(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) collectFiles(root, out);
  return out
    .filter((file) => file.endsWith('.jsonl'))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, MAX_HISTORY_FILES);
}

function collectFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function readJsonl(filePath: string, limit: number): unknown[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const records: unknown[] = [];
  for (const line of content.split('\n')) {
    if (records.length >= limit) break;
    if (!line.trim()) continue;
    const parsed = safeJson(line);
    if (parsed != null) records.push(parsed);
  }
  return records;
}

interface ParsedHistoryRecord {
  role: string | null;
  text: string;
  cwd: string | null;
  sessionId: string | null;
}

function parseCodexRecord(record: unknown): ParsedHistoryRecord {
  const obj = asRecord(record);
  const payload = asRecord(obj.payload);
  const type = stringValue(obj.type) ?? stringValue(payload.type);
  const role = stringValue(payload.role) ?? type ?? null;
  const cwd =
    stringValue(payload.cwd) ??
    stringValue(asRecord(payload.turn_context).cwd) ??
    stringValue(asRecord(payload.git).cwd);
  const sessionId = stringValue(payload.id) ?? stringValue(payload.session_id);
  const text =
    stringValue(payload.message) ??
    stringValue(payload.summary) ??
    textFromContent(payload.content) ??
    textFromContent(payload.text_elements);
  return { role, text: (text ?? '').trim(), cwd, sessionId };
}

function parseClaudeRecord(record: unknown): ParsedHistoryRecord {
  const obj = asRecord(record);
  const role = stringValue(obj.type);
  const cwd =
    stringValue(obj.cwd) ??
    stringValue(asRecord(obj.tool_input).cwd) ??
    stringValue(asRecord(obj.tool_input).path);
  const sessionId = stringValue(obj.session_id);
  const text =
    textFromContent(obj.content) ??
    stringValue(obj.tool_output) ??
    stringValue(obj.message) ??
    textFromContent(obj.tool_input);
  return { role, text: (text ?? '').trim(), cwd, sessionId };
}

function formatParsedRecord(record: ParsedHistoryRecord): string {
  const role = record.role ?? 'entry';
  return `### ${role}\n${record.text}`;
}

function formatRecordText(record: unknown, fallbackRole: string): string {
  const obj = asRecord(record);
  const role = stringValue(obj.role) ?? stringValue(obj.type) ?? fallbackRole;
  const text = textFromContent(obj) ?? '';
  if (!text.trim()) return '';
  return `### ${role}\n${text.trim()}`;
}

function buildContext(provider: AgentHistoryProvider, title: string, context: string): string {
  const clipped =
    context.length > MAX_CONTEXT_CHARS
      ? `${context.slice(0, MAX_CONTEXT_CHARS)}\n\n[History truncated by Differ]`
      : context;
  return `Use this previous ${provider} session as context.\n\nSession: ${title}\n\n${clipped}`;
}

interface OpenCodeSessionRow {
  id: string;
  title: string;
  directory: string;
  path: string | null;
  agent: string | null;
  time_updated: number;
}

function openCodeEntry(row: OpenCodeSessionRow): AgentHistoryEntry {
  return {
    id: encodeHistoryId(row.id),
    provider: 'opencode',
    title: row.title || row.id,
    file_path: null,
    session_id: row.id,
    cwd: row.path ?? row.directory,
    updated_at: new Date(row.time_updated).toISOString(),
    message_count: 0,
    preview: row.agent ? `Agent: ${row.agent}` : row.directory,
  };
}

function titleFromFile(provider: AgentHistoryProvider, filePath: string, preview: string): string {
  const base = path.basename(filePath).replace(/\.(jsonl|json)$/i, '');
  const first = preview.split(/[.!?\n]/)[0]?.trim();
  return first ? `${first.slice(0, 72)}` : `${provider} ${base}`;
}

function isRepoMatch(cwd: string | null, repoPath: string): boolean {
  return !!cwd && (cwd === repoPath || cwd.startsWith(`${repoPath}${path.sep}`));
}

function firstLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_PREVIEW_CHARS);
}

function encodeHistoryId(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeHistoryId(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => textFromContent(item))
      .filter(Boolean)
      .join('\n');
  }
  const obj = asRecord(value);
  if (!Object.keys(obj).length) return null;
  return (
    stringValue(obj.text) ??
    stringValue(obj.content) ??
    stringValue(obj.message) ??
    Object.entries(obj)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  );
}
