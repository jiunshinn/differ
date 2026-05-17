import path from 'node:path';
import { getDb } from './db';
import type { Repository } from '../../shared/types';

export function upsertRepository(
  repoPath: string,
  fields: {
    name: string;
    default_branch: string | null;
    remote_url: string | null;
    github_owner: string | null;
    github_repo: string | null;
  },
): Repository {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM repositories WHERE path = ?`).get(repoPath) as
    | Repository
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE repositories
         SET name = ?, default_branch = ?, remote_url = ?, github_owner = ?, github_repo = ?, last_opened_at = datetime('now')
         WHERE id = ?`,
    ).run(
      fields.name,
      fields.default_branch,
      fields.remote_url,
      fields.github_owner,
      fields.github_repo,
      existing.id,
    );
    return db.prepare(`SELECT * FROM repositories WHERE id = ?`).get(existing.id) as Repository;
  }
  const result = db
    .prepare(
      `INSERT INTO repositories (path, name, default_branch, remote_url, github_owner, github_repo)
         VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repoPath,
      fields.name,
      fields.default_branch,
      fields.remote_url,
      fields.github_owner,
      fields.github_repo,
    );
  return db.prepare(`SELECT * FROM repositories WHERE id = ?`).get(result.lastInsertRowid) as Repository;
}

export function listRecentRepositories(limit = 20): Repository[] {
  return getDb()
    .prepare(`SELECT * FROM repositories ORDER BY last_opened_at DESC LIMIT ?`)
    .all(limit) as Repository[];
}

export function getRepositoryById(id: number): Repository | null {
  return (getDb().prepare(`SELECT * FROM repositories WHERE id = ?`).get(id) as Repository) ?? null;
}

export function removeRepository(id: number): void {
  getDb().prepare(`DELETE FROM repositories WHERE id = ?`).run(id);
}

export function basenameOfPath(p: string): string {
  return path.basename(p) || p;
}
