import path from 'node:path';
import { getDb, transaction } from './db';
import type { Repository } from '../../shared/types';

export function upsertRepository(
  repoPath: string,
  fields: {
    name: string;
    default_branch: string | null;
    remote_url: string | null;
    github_owner: string | null;
    github_repo: string | null;
    /** Machine the working copy lives on ('local' or an ssh environment id). */
    environment_id?: string;
    // When provided, write the binding. When undefined, preserve any existing binding on update.
    github_account_id?: number | null;
  },
): Repository {
  const db = getDb();
  const environmentId = fields.environment_id ?? 'local';
  const existing = db.prepare(`SELECT * FROM repositories WHERE path = ?`).get(repoPath) as
    | Repository
    | undefined;
  if (existing) {
    if (fields.github_account_id !== undefined) {
      db.prepare(
        `UPDATE repositories
           SET name = ?, default_branch = ?, remote_url = ?, github_owner = ?, github_repo = ?,
               environment_id = ?, github_account_id = ?, last_opened_at = datetime('now')
           WHERE id = ?`,
      ).run(
        fields.name,
        fields.default_branch,
        fields.remote_url,
        fields.github_owner,
        fields.github_repo,
        environmentId,
        fields.github_account_id,
        existing.id,
      );
    } else {
      db.prepare(
        `UPDATE repositories
           SET name = ?, default_branch = ?, remote_url = ?, github_owner = ?, github_repo = ?,
               environment_id = ?, last_opened_at = datetime('now')
           WHERE id = ?`,
      ).run(
        fields.name,
        fields.default_branch,
        fields.remote_url,
        fields.github_owner,
        fields.github_repo,
        environmentId,
        existing.id,
      );
    }
    return db.prepare(`SELECT * FROM repositories WHERE id = ?`).get(existing.id) as Repository;
  }
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM repositories`).get() as {
    m: number;
  };
  const result = db
    .prepare(
      `INSERT INTO repositories (path, environment_id, name, default_branch, remote_url, github_owner, github_repo, github_account_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repoPath,
      environmentId,
      fields.name,
      fields.default_branch,
      fields.remote_url,
      fields.github_owner,
      fields.github_repo,
      fields.github_account_id ?? null,
      max.m + 1,
    );
  return db.prepare(`SELECT * FROM repositories WHERE id = ?`).get(result.lastInsertRowid) as Repository;
}

export function listRecentRepositories(limit = 50): Repository[] {
  return getDb()
    .prepare(
      `SELECT * FROM repositories
         ORDER BY pinned DESC, sort_order ASC, last_opened_at DESC
         LIMIT ?`,
    )
    .all(limit) as Repository[];
}

export function getRepositoryById(id: number): Repository | null {
  return (getDb().prepare(`SELECT * FROM repositories WHERE id = ?`).get(id) as Repository) ?? null;
}

/** The repository row for a working copy path, if we've seen it before. */
export function getRepositoryByPath(repoPath: string): Repository | null {
  return (getDb().prepare(`SELECT * FROM repositories WHERE path = ?`).get(repoPath) as Repository) ?? null;
}

export function removeRepository(id: number): void {
  getDb().prepare(`DELETE FROM repositories WHERE id = ?`).run(id);
}

export function setRepositoryPinned(id: number, pinned: boolean): Repository | null {
  getDb()
    .prepare(`UPDATE repositories SET pinned = ? WHERE id = ?`)
    .run(pinned ? 1 : 0, id);
  return getRepositoryById(id);
}

export function reorderRepositories(orderedIds: number[]): void {
  const db = getDb();
  const update = db.prepare(`UPDATE repositories SET sort_order = ? WHERE id = ?`);
  const tx = transaction((ids: number[]) => {
    ids.forEach((id, i) => update.run(i + 1, id));
  });
  tx(orderedIds);
}

export function basenameOfPath(p: string): string {
  return path.basename(p) || p;
}
