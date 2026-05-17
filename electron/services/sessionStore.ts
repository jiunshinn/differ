import { getDb } from './db';
import type { ReviewSession } from '../../shared/types';

export function ensureLocalSession(repoId: number, branch: string | null): ReviewSession {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM review_sessions WHERE repository_id = ? AND kind = 'local'`)
    .get(repoId) as ReviewSession | undefined;
  if (existing) {
    db.prepare(`UPDATE review_sessions SET branch = ?, updated_at = datetime('now') WHERE id = ?`).run(
      branch,
      existing.id,
    );
    return db.prepare(`SELECT * FROM review_sessions WHERE id = ?`).get(existing.id) as ReviewSession;
  }
  const r = db
    .prepare(
      `INSERT INTO review_sessions (repository_id, kind, branch) VALUES (?, 'local', ?)`,
    )
    .run(repoId, branch);
  return db.prepare(`SELECT * FROM review_sessions WHERE id = ?`).get(r.lastInsertRowid) as ReviewSession;
}

export function ensurePrSession(
  repoId: number,
  prNumber: number,
  headSha: string,
  baseSha: string,
  branch: string,
  baseBranch: string,
): ReviewSession {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM review_sessions WHERE repository_id = ? AND github_pr_number = ?`)
    .get(repoId, prNumber) as ReviewSession | undefined;
  if (existing) {
    db.prepare(
      `UPDATE review_sessions
         SET head_sha = ?, base_sha = ?, branch = ?, base_branch = ?, updated_at = datetime('now')
         WHERE id = ?`,
    ).run(headSha, baseSha, branch, baseBranch, existing.id);
    return db.prepare(`SELECT * FROM review_sessions WHERE id = ?`).get(existing.id) as ReviewSession;
  }
  const r = db
    .prepare(
      `INSERT INTO review_sessions (repository_id, kind, branch, base_branch, head_sha, base_sha, github_pr_number)
         VALUES (?, 'pull_request', ?, ?, ?, ?, ?)`,
    )
    .run(repoId, branch, baseBranch, headSha, baseSha, prNumber);
  return db.prepare(`SELECT * FROM review_sessions WHERE id = ?`).get(r.lastInsertRowid) as ReviewSession;
}

export function getSession(id: number): ReviewSession | null {
  return (getDb().prepare(`SELECT * FROM review_sessions WHERE id = ?`).get(id) as ReviewSession) ?? null;
}
