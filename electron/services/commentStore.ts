import { getDb, stmt } from './db';
import type {
  CommentDiffSide,
  CommentLabel,
  CommentStatus,
  CommentTargetKind,
  ReviewComment,
} from '../../shared/types';

export interface CreateCommentInput {
  review_session_id: number;
  file_path: string;
  target_kind: CommentTargetKind;
  diff_side: CommentDiffSide;
  line_number: number | null;
  hunk_header: string | null;
  body: string;
  label: CommentLabel;
}

export interface UpdateCommentInput {
  body?: string;
  label?: CommentLabel;
  status?: CommentStatus;
}

export function listComments(sessionId: number): ReviewComment[] {
  // Tie-break by id (monotonic rowid) so comments created within the same
  // 1-second created_at tick keep a stable, deterministic order across refetches.
  return stmt(
    `SELECT * FROM review_comments WHERE review_session_id = ? ORDER BY created_at ASC, id ASC`,
  ).all(sessionId) as ReviewComment[];
}

export function createComment(input: CreateCommentInput): ReviewComment {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO review_comments
         (review_session_id, file_path, target_kind, diff_side, line_number, hunk_header, body, label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.review_session_id,
      input.file_path,
      input.target_kind,
      input.diff_side,
      input.line_number,
      input.hunk_header,
      input.body,
      input.label,
    );
  return db.prepare(`SELECT * FROM review_comments WHERE id = ?`).get(r.lastInsertRowid) as ReviewComment;
}

export function updateComment(id: number, patch: UpdateCommentInput): ReviewComment | null {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.body !== undefined) {
    sets.push('body = ?');
    args.push(patch.body);
  }
  if (patch.label !== undefined) {
    sets.push('label = ?');
    args.push(patch.label);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    args.push(patch.status);
  }
  if (!sets.length) return (db.prepare(`SELECT * FROM review_comments WHERE id = ?`).get(id) as ReviewComment) ?? null;
  sets.push(`updated_at = datetime('now')`);
  args.push(id);
  db.prepare(`UPDATE review_comments SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return (db.prepare(`SELECT * FROM review_comments WHERE id = ?`).get(id) as ReviewComment) ?? null;
}

export function deleteComment(id: number): void {
  getDb().prepare(`DELETE FROM review_comments WHERE id = ?`).run(id);
}
