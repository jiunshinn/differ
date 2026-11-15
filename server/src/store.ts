import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ThreadEvent, ThreadEventRecord, ThreadStatus, ThreadSummary } from '../../shared/protocol.js';

interface ThreadRow {
  id: string;
  title: string;
  agent_id: string;
  cwd: string;
  status: ThreadStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const toSummary = (r: ThreadRow): ThreadSummary => ({
  id: r.id,
  title: r.title,
  agentId: r.agent_id,
  cwd: r.cwd,
  status: r.status,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Threads and their append-only event logs. */
export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'server.sqlite3'));
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_events (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        at TEXT NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (thread_id, seq)
      );
    `);
    // A server restart ends every agent process; nothing is running any more.
    this.db
      .prepare(`UPDATE threads SET status = 'idle' WHERE status IN ('starting', 'running', 'waiting')`)
      .run();
  }

  listThreads(): ThreadSummary[] {
    const rows = this.db.prepare('SELECT * FROM threads ORDER BY updated_at DESC').all() as unknown as ThreadRow[];
    return rows.map(toSummary);
  }

  getThread(id: string): ThreadSummary | null {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as unknown as ThreadRow | undefined;
    return row ? toSummary(row) : null;
  }

  createThread(t: Omit<ThreadSummary, 'createdAt' | 'updatedAt' | 'error'>): ThreadSummary {
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO threads (id, title, agent_id, cwd, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(t.id, t.title, t.agentId, t.cwd, t.status, now, now);
    return this.getThread(t.id)!;
  }

  updateThread(id: string, patch: { title?: string; status?: ThreadStatus; error?: string | null }): ThreadSummary | null {
    const cur = this.getThread(id);
    if (!cur) return null;
    this.db
      .prepare('UPDATE threads SET title = ?, status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title ?? cur.title,
        patch.status ?? cur.status,
        patch.error === undefined ? (cur.error ?? null) : patch.error,
        new Date().toISOString(),
        id,
      );
    return this.getThread(id);
  }

  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  }

  appendEvent(threadId: string, event: ThreadEvent): ThreadEventRecord {
    const at = new Date().toISOString();
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM thread_events WHERE thread_id = ?').get(threadId) as { seq: number };
    this.db.prepare('INSERT INTO thread_events (thread_id, seq, at, event) VALUES (?, ?, ?, ?)').run(threadId, row.seq, at, JSON.stringify(event));
    return { threadId, seq: row.seq, at, event };
  }

  listEvents(threadId: string): ThreadEventRecord[] {
    const rows = this.db
      .prepare('SELECT seq, at, event FROM thread_events WHERE thread_id = ? ORDER BY seq')
      .all(threadId) as { seq: number; at: string; event: string }[];
    return rows.map((r) => ({ threadId, seq: r.seq, at: r.at, event: JSON.parse(r.event) as ThreadEvent }));
  }

  close(): void {
    this.db.close();
  }
}
