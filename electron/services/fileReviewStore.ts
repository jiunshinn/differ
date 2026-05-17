import { getDb } from './db';
import type { FileReviewState, FileReviewStatus } from '../../shared/types';

export function listFileStates(sessionId: number): FileReviewState[] {
  return getDb()
    .prepare(`SELECT * FROM file_review_states WHERE review_session_id = ?`)
    .all(sessionId) as FileReviewState[];
}

export function setFileState(
  sessionId: number,
  filePath: string,
  status: FileReviewStatus,
): FileReviewState {
  const db = getDb();
  db.prepare(
    `INSERT INTO file_review_states (review_session_id, file_path, status)
       VALUES (?, ?, ?)
       ON CONFLICT(review_session_id, file_path) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
  ).run(sessionId, filePath, status);
  return db
    .prepare(`SELECT * FROM file_review_states WHERE review_session_id = ? AND file_path = ?`)
    .get(sessionId, filePath) as FileReviewState;
}
