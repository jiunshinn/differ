import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'differ.sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function applyMigrations(d: Database.Database): void {
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

    CREATE TABLE IF NOT EXISTS context_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_session_id INTEGER NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      task TEXT NOT NULL DEFAULT '',
      included_comments_json TEXT NOT NULL DEFAULT '[]',
      included_files_json TEXT NOT NULL DEFAULT '[]',
      included_hunks_json TEXT NOT NULL DEFAULT '[]',
      output_markdown TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
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
