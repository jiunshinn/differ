import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementResultingChanges, type StatementSync } from 'node:sqlite';

/** better-sqlite3 bound `undefined` as NULL; node:sqlite throws, so we normalise it. */
export type Param = SQLInputValue | undefined;

/**
 * The slice of node:sqlite the stores use. Rows come back as `unknown` so call
 * sites cast to their row type (`.get(id) as Repository`), as they did with better-sqlite3.
 */
export interface Statement {
  run(...params: Param[]): StatementResultingChanges;
  get(...params: Param[]): unknown;
  all(...params: Param[]): unknown[];
}
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  readonly isTransaction: boolean;
}

const bind = (params: Param[]): SQLInputValue[] => params.map((p) => (p === undefined ? null : p));

function wrapStatement(s: StatementSync): Statement {
  return {
    run: (...p) => s.run(...bind(p)),
    get: (...p) => s.get(...bind(p)),
    all: (...p) => s.all(...bind(p)),
  };
}

function wrapDb(raw: DatabaseSync): Db {
  return {
    prepare: (sql) => wrapStatement(raw.prepare(sql)),
    exec: (sql) => raw.exec(sql),
    get isTransaction() {
      return raw.isTransaction;
    },
  };
}

// Node's built-in SQLite (bundled with Electron's Node). No native add-on to compile.
let raw: DatabaseSync | null = null;
let db: Db | null = null;
const statements = new Map<string, Statement>();

export function initDatabase(): Db {
  if (db) return db;
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'differ.sqlite3');
  raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  db = wrapDb(raw);
  applyMigrations(db);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not initialized');
  return db;
}

/** Prepared statement, cached by SQL text. */
export function stmt(sql: string): Statement {
  let s = statements.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

/**
 * Wraps fn in BEGIN/COMMIT and rolls back if it throws. Same contract as
 * better-sqlite3's db.transaction(): returns a function you call to run it.
 * Nested calls run inside the outer transaction.
 */
export function transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    const d = getDb();
    if (d.isTransaction) return fn(...args);
    d.exec('BEGIN');
    try {
      const result = fn(...args);
      d.exec('COMMIT');
      return result;
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  };
}

export function closeDatabase(): void {
  statements.clear();
  raw?.close();
  raw = null;
  db = null;
}

function applyMigrations(d: Db): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      default_branch TEXT,
      remote_url TEXT,
      github_owner TEXT,
      github_repo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_opened_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('local','pull_request')),
      branch TEXT,
      base_branch TEXT,
      head_sha TEXT,
      base_sha TEXT,
      github_pr_number INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_local
      ON review_sessions(repository_id, kind) WHERE kind = 'local';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_pr
      ON review_sessions(repository_id, github_pr_number) WHERE github_pr_number IS NOT NULL;

    CREATE TABLE IF NOT EXISTS review_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_session_id INTEGER NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('file','line','hunk')),
      diff_side TEXT NOT NULL DEFAULT 'none' CHECK (diff_side IN ('old','new','none')),
      line_number INTEGER,
      hunk_header TEXT,
      body TEXT NOT NULL,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comment_session ON review_comments(review_session_id);
    CREATE INDEX IF NOT EXISTS idx_comment_file ON review_comments(review_session_id, file_path);

    CREATE TABLE IF NOT EXISTS file_review_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_session_id INTEGER NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unviewed' CHECK (status IN ('unviewed','viewed','reviewed')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (review_session_id, file_path)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS github_accounts (
      id INTEGER PRIMARY KEY,
      login TEXT NOT NULL,
      avatar_url TEXT,
      scopes TEXT NOT NULL DEFAULT '',
      token_encrypted TEXT,
      token_plain TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(d, 'repositories', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'repositories', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'repositories', 'github_account_id', 'INTEGER');
  // Seed sort_order for existing rows so they keep a stable order matching last_opened_at.
  const seeded = d
    .prepare(`SELECT COUNT(*) AS n FROM repositories WHERE sort_order != 0`)
    .get() as { n: number };
  if (seeded.n === 0) {
    const rows = d
      .prepare(`SELECT id FROM repositories ORDER BY last_opened_at DESC`)
      .all() as { id: number }[];
    const update = d.prepare(`UPDATE repositories SET sort_order = ? WHERE id = ?`);
    rows.forEach((r, i) => update.run(i + 1, r.id));
  }
}

function ensureColumn(d: Db, table: string, column: string, decl: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .run(key, value);
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function deleteSetting(key: string): void {
  getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
}
