import { app, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

// Cache of prepared statements keyed by SQL text. better-sqlite3 does not cache
// prepared statements internally, so reusing them avoids re-parsing/compiling the
// same SQL on every call (hot paths like listComments/listFileStates fire per
// file click). Cleared in closeDatabase().
const statementCache = new Map<string, Database.Statement>();

function openAndMigrate(dbPath: string): Database.Database {
  const handle = new Database(dbPath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  applyMigrations(handle);
  return handle;
}

export function initDatabase(): Database.Database {
  if (db) return db;
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'differ.sqlite3');
  try {
    db = openAndMigrate(dbPath);
  } catch (err) {
    // A corrupt / non-database file (SQLITE_CORRUPT / SQLITE_NOTADB) would throw
    // on the first pragma or migration. Move the bad file aside so the app can
    // recover on the next open instead of launching with no window.
    const message = err instanceof Error ? err.message : String(err);
    quarantineDatabase(dbPath);
    try {
      db = openAndMigrate(dbPath);
    } catch (retryErr) {
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
      try {
        dialog.showErrorBox(
          'Differ database error',
          `Differ could not open its local database and was unable to recover automatically.\n\n${retryMessage}\n\nThe damaged file was moved aside in:\n${userDataDir}`,
        );
      } catch {
        // dialog may be unavailable very early; the throw below still surfaces it.
      }
      throw retryErr;
    }
    try {
      dialog.showErrorBox(
        'Differ database reset',
        `Differ's local database was corrupt and could not be opened, so it was reset.\n\nA backup of the damaged file was kept in:\n${userDataDir}\n\nDetails: ${message}`,
      );
    } catch {
      // Ignore dialog failures; recovery already succeeded.
    }
  }
  return db;
}

// Move a corrupt database (and its WAL/SHM sidecars) aside so a fresh one can be
// created. Best-effort: failures here are swallowed so the caller can still retry.
function quarantineDatabase(dbPath: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${dbPath}${suffix}`;
    try {
      if (fs.existsSync(from)) {
        fs.renameSync(from, `${dbPath}.corrupt-${stamp}${suffix}`);
      }
    } catch {
      // Ignore; if we cannot move it, the retry open will fail and surface clearly.
    }
  }
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// Returns a cached prepared statement for the given SQL, preparing it once on
// first use. Stores must use this instead of getDb().prepare(...) on hot paths.
export function stmt(sql: string): Database.Statement {
  let cached = statementCache.get(sql);
  if (!cached) {
    cached = getDb().prepare(sql);
    statementCache.set(sql, cached);
  }
  return cached;
}

export function closeDatabase(): void {
  if (db) {
    statementCache.clear();
    db.close();
    db = null;
  }
}

// Current schema version. Bump this and add a matching entry to MIGRATIONS when
// making a non-additive schema change (a CHECK list change, NOT NULL change,
// index change, or data transform) so existing installs are upgraded too.
const SCHEMA_VERSION = 1;

// Ordered migrations keyed by the version they produce. Each runs exactly once,
// inside a single transaction, only when the DB's user_version is below it.
// Migration 1 is the baseline schema (idempotent CREATE ... IF NOT EXISTS), so it
// also adopts pre-versioning databases without rewriting their data.
const MIGRATIONS: { version: number; up: (d: Database.Database) => void }[] = [
  { version: 1, up: applyBaselineSchema },
];

// Guard against forgetting to register a migration for a bumped SCHEMA_VERSION.
if (MIGRATIONS[MIGRATIONS.length - 1]?.version !== SCHEMA_VERSION) {
  throw new Error(`MIGRATIONS is missing an entry for schema version ${SCHEMA_VERSION}`);
}

function applyMigrations(d: Database.Database): void {
  const current = (d.pragma('user_version', { simple: true }) as number) ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    // Run each migration's schema changes atomically. PRAGMA user_version is a
    // no-op inside an active transaction, so it is bumped immediately after the
    // commit: a crash before this point leaves user_version unchanged and the
    // migration re-runs cleanly (each up() is written to be idempotent).
    d.transaction(() => {
      migration.up(d);
    })();
    d.pragma(`user_version = ${migration.version}`);
  }
}

function applyBaselineSchema(d: Database.Database): void {
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
  // Seed sort_order for existing rows so they keep a stable order matching
  // last_opened_at. A single UPDATE is atomic, so a crash mid-seed can never
  // leave some repos seeded and others stranded at sort_order 0 (which would
  // pin them to the top of the recents list forever). Runs only while every row
  // is still at the default 0, so it is a no-op once any seeding has happened.
  const seeded = d
    .prepare(`SELECT COUNT(*) AS n FROM repositories WHERE sort_order != 0`)
    .get() as { n: number };
  if (seeded.n === 0) {
    d.exec(`
      UPDATE repositories SET sort_order = (
        SELECT COUNT(*) FROM repositories r2
        WHERE r2.last_opened_at >= repositories.last_opened_at
      )
    `);
  }
}

function ensureColumn(d: Database.Database, table: string, column: string, decl: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export function setSetting(key: string, value: string): void {
  stmt(
    `INSERT INTO app_settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(key, value);
}

export function getSetting(key: string): string | null {
  const row = stmt(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function deleteSetting(key: string): void {
  stmt(`DELETE FROM app_settings WHERE key = ?`).run(key);
}
