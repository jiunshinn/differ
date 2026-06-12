import { getDb } from './db';

export interface GithubAccountRow {
  id: number;
  login: string;
  avatar_url: string | null;
  scopes: string;
  token_encrypted: string | null;
  token_plain: string | null;
  added_at: string;
  updated_at: string;
}

export function listAccountRows(): GithubAccountRow[] {
  return getDb()
    .prepare(`SELECT * FROM github_accounts ORDER BY added_at ASC`)
    .all() as GithubAccountRow[];
}

export function getAccountRow(id: number): GithubAccountRow | null {
  return (
    (getDb().prepare(`SELECT * FROM github_accounts WHERE id = ?`).get(id) as GithubAccountRow) ??
    null
  );
}

export interface UpsertAccountInput {
  id: number;
  login: string;
  avatarUrl: string | null;
  scopes: string[];
  tokenEncrypted: string | null;
  // Plaintext fallback used ONLY when OS-backed encryption is unavailable
  // (see githubService.encryptToken). When set, the account is flagged
  // tokenStoredPlaintext so the UI can warn the user the token is at rest
  // unencrypted. Exactly one of tokenEncrypted / tokenPlain is non-null.
  tokenPlain: string | null;
}

export function upsertAccount(input: UpsertAccountInput): void {
  getDb()
    .prepare(
      `INSERT INTO github_accounts (id, login, avatar_url, scopes, token_encrypted, token_plain)
         VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         login = excluded.login,
         avatar_url = excluded.avatar_url,
         scopes = excluded.scopes,
         token_encrypted = excluded.token_encrypted,
         token_plain = excluded.token_plain,
         updated_at = datetime('now')`,
    )
    .run(
      input.id,
      input.login,
      input.avatarUrl,
      input.scopes.join(','),
      input.tokenEncrypted,
      input.tokenPlain,
    );
}

export function deleteAccount(id: number): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE repositories SET github_account_id = NULL WHERE github_account_id = ?`).run(id);
    db.prepare(`DELETE FROM github_accounts WHERE id = ?`).run(id);
  });
  tx();
}

export function listRepoIdsForAccount(accountId: number): number[] {
  const rows = getDb()
    .prepare(`SELECT id FROM repositories WHERE github_account_id = ?`)
    .all(accountId) as { id: number }[];
  return rows.map((r) => r.id);
}

function assertAccountExists(accountId: number): void {
  // repositories.github_account_id has no enforced FK on existing installs (the
  // column predates any REFERENCES clause), and these ids arrive from the
  // renderer over IPC. Validate on the write path so a stale/bogus id cannot
  // create a binding to a nonexistent github_accounts row.
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM github_accounts WHERE id = ?`)
    .get(accountId) as { ok: number } | undefined;
  if (!row) {
    throw new Error(`GitHub account ${accountId} does not exist.`);
  }
}

export function rebindRepos(fromAccountId: number, toAccountId: number | null): number {
  if (toAccountId != null) assertAccountExists(toAccountId);
  const result = getDb()
    .prepare(`UPDATE repositories SET github_account_id = ? WHERE github_account_id = ?`)
    .run(toAccountId, fromAccountId);
  return Number(result.changes ?? 0);
}

export function setRepoAccount(repoId: number, accountId: number | null): void {
  if (accountId != null) assertAccountExists(accountId);
  getDb()
    .prepare(`UPDATE repositories SET github_account_id = ? WHERE id = ?`)
    .run(accountId, repoId);
}

export function backfillRepoAccounts(accountId: number): number {
  // Used during legacy single-token migration: assign every repo that has a github_owner
  // but no account id yet to the migrated account.
  const result = getDb()
    .prepare(
      `UPDATE repositories
         SET github_account_id = ?
         WHERE github_account_id IS NULL AND github_owner IS NOT NULL`,
    )
    .run(accountId);
  return Number(result.changes ?? 0);
}
