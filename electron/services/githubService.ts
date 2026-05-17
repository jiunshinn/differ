import { Octokit } from '@octokit/rest';
import { safeStorage } from 'electron';
import { deleteSetting, getSetting } from './db';
import {
  deleteAccount as deleteAccountRow,
  getAccountRow,
  listAccountRows,
  upsertAccount,
  backfillRepoAccounts,
  rebindRepos as rebindReposInStore,
  listRepoIdsForAccount,
  setRepoAccount,
} from './accountStore';
import type {
  GithubAccount,
  GithubCheckRun,
  GithubIssueDetail,
  GithubIssueLabel,
  GithubIssueStateFilter,
  GithubIssueSummary,
  GithubIssueUserRef,
  GithubOwnerRef,
  GithubPullRequestDetail,
  GithubPullRequestStateFilter,
  GithubPullRequestSummary,
  GithubRepoSummary,
  GithubSubmitReviewInput,
} from '../../shared/types';

const LEGACY_TOKEN_KEY = 'github_token_encrypted';
const LEGACY_TOKEN_PLAIN_KEY = 'github_token_plain';

interface CachedClient {
  account: GithubAccount;
  octokit: Octokit;
  token: string;
}

const clients = new Map<number, CachedClient>();
let loaded = false;
let legacyMigrationAttempted = false;

function encryptToken(token: string): { encrypted: string | null; plain: string | null } {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: safeStorage.encryptString(token).toString('base64'), plain: null };
  }
  return { encrypted: null, plain: token };
}

function decryptStoredToken(encrypted: string | null, plain: string | null): string | null {
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }
  return plain;
}

function buildClient(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'differ-mvp' });
}

interface UserProbeResult {
  id: number;
  login: string;
  avatarUrl: string | null;
  scopes: string[];
}

async function probeUser(octokit: Octokit): Promise<UserProbeResult> {
  const res = await octokit.request('GET /user');
  const data = res.data as { id: number; login: string; avatar_url?: string | null };
  const scopeHeader = res.headers['x-oauth-scopes'] as string | undefined;
  const scopes = scopeHeader
    ? scopeHeader.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    id: data.id,
    login: data.login,
    avatarUrl: data.avatar_url ?? null,
    scopes,
  };
}

function rowToAccount(row: ReturnType<typeof getAccountRow> & object): GithubAccount {
  return {
    id: row.id,
    login: row.login,
    avatarUrl: row.avatar_url,
    scopes: row.scopes ? row.scopes.split(',').filter(Boolean) : [],
    addedAt: row.added_at,
  };
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const rows = listAccountRows();
  for (const row of rows) {
    const token = decryptStoredToken(row.token_encrypted, row.token_plain);
    if (!token) continue;
    clients.set(row.id, {
      account: rowToAccount(row),
      octokit: buildClient(token),
      token,
    });
  }
}

async function maybeMigrateLegacyToken(): Promise<void> {
  if (legacyMigrationAttempted) return;
  legacyMigrationAttempted = true;
  ensureLoaded();
  if (clients.size > 0) return;
  const encrypted = getSetting(LEGACY_TOKEN_KEY);
  const plain = getSetting(LEGACY_TOKEN_PLAIN_KEY);
  if (!encrypted && !plain) return;
  const token = decryptStoredToken(encrypted, plain);
  if (!token) return;
  try {
    const probe = await probeUser(buildClient(token));
    addAccountFromProbe(token, probe);
    backfillRepoAccounts(probe.id);
  } catch {
    // Legacy token invalid — leave the old keys in place so the user can re-auth.
    return;
  }
  deleteSetting(LEGACY_TOKEN_KEY);
  deleteSetting(LEGACY_TOKEN_PLAIN_KEY);
}

function addAccountFromProbe(token: string, probe: UserProbeResult): GithubAccount {
  const { encrypted, plain } = encryptToken(token);
  upsertAccount({
    id: probe.id,
    login: probe.login,
    avatarUrl: probe.avatarUrl,
    scopes: probe.scopes,
    tokenEncrypted: encrypted,
    tokenPlain: plain,
  });
  const row = getAccountRow(probe.id);
  if (!row) throw new Error('Account row vanished after upsert');
  const account = rowToAccount(row);
  clients.set(probe.id, {
    account,
    octokit: buildClient(token),
    token,
  });
  return account;
}

export async function listAccounts(): Promise<GithubAccount[]> {
  await maybeMigrateLegacyToken();
  return Array.from(clients.values()).map((c) => c.account);
}

export async function addAccount(token: string): Promise<GithubAccount> {
  await maybeMigrateLegacyToken();
  const probe = await probeUser(buildClient(token));
  return addAccountFromProbe(token, probe);
}

export async function removeAccount(accountId: number): Promise<void> {
  ensureLoaded();
  deleteAccountRow(accountId);
  clients.delete(accountId);
}

export function listReposBoundToAccount(accountId: number): number[] {
  return listRepoIdsForAccount(accountId);
}

export function rebindRepos(fromAccountId: number, toAccountId: number | null): number {
  return rebindReposInStore(fromAccountId, toAccountId);
}

export function setAccountForRepo(repoId: number, accountId: number | null): void {
  setRepoAccount(repoId, accountId);
}

function mustClient(accountId: number): Octokit {
  ensureLoaded();
  const c = clients.get(accountId);
  if (!c) {
    throw new Error(
      `GitHub account ${accountId} is not signed in. Add it from the account menu in the top bar.`,
    );
  }
  return c.octokit;
}

export function getTokenForAccount(accountId: number): string | null {
  ensureLoaded();
  return clients.get(accountId)?.token ?? null;
}

export async function listPullRequests(
  accountId: number,
  owner: string,
  repo: string,
  state: GithubPullRequestStateFilter = 'open',
): Promise<GithubPullRequestSummary[]> {
  const client = mustClient(accountId);
  const apiState = state === 'merged' ? 'closed' : state;
  const results: GithubPullRequestSummary[] = [];

  for (let page = 1; page <= 5; page += 1) {
    const res = await client.pulls.list({
      owner,
      repo,
      state: apiState,
      per_page: 100,
      page,
      sort: 'updated',
      direction: 'desc',
    });

    for (const raw of res.data) {
      const pr = mapPullRequestSummary(raw, accountId);
      if (state === 'all' || pr.state === state) {
        results.push(pr);
      }
      if (results.length >= 50) break;
    }

    if (results.length >= 50 || res.data.length < 100) break;
  }

  return results;
}

type OctokitPullRequest = Awaited<ReturnType<Octokit['pulls']['list']>>['data'][number];

function mapPullRequestSummary(pr: OctokitPullRequest, accountId: number): GithubPullRequestSummary {
  const prState: GithubPullRequestSummary['state'] = pr.merged_at
    ? 'merged'
    : (pr.state as 'open' | 'closed');
  return {
    number: pr.number,
    title: pr.title,
    state: prState,
    isDraft: !!pr.draft,
    author: pr.user?.login ?? 'unknown',
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    url: pr.html_url,
    updatedAt: pr.updated_at,
    reviewDecision: null,
    accountId,
  };
}

export async function getPullRequestDetail(
  accountId: number,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GithubPullRequestDetail> {
  const client = mustClient(accountId);
  const { data } = await client.pulls.get({ owner, repo, pull_number: prNumber });
  return {
    number: data.number,
    title: data.title,
    state: data.merged_at ? 'merged' : (data.state as 'open' | 'closed'),
    isDraft: !!data.draft,
    author: data.user?.login ?? 'unknown',
    headRef: data.head.ref,
    baseRef: data.base.ref,
    headSha: data.head.sha,
    baseSha: data.base.sha,
    url: data.html_url,
    updatedAt: data.updated_at,
    reviewDecision: null,
    body: data.body ?? '',
    mergeable: data.mergeable ?? null,
    changedFiles: data.changed_files,
    additions: data.additions,
    deletions: data.deletions,
    accountId,
  };
}

type OctokitIssue = Awaited<ReturnType<Octokit['issues']['listForRepo']>>['data'][number];
type OctokitIssueDetail = Awaited<ReturnType<Octokit['issues']['get']>>['data'];
type OctokitIssueComment = Awaited<ReturnType<Octokit['issues']['listComments']>>['data'][number];
type OctokitIssueLabel = string | {
  name?: string | null;
  color?: string | null;
  description?: string | null;
};

function mapIssueLabel(label: OctokitIssueLabel): GithubIssueLabel {
  if (typeof label === 'string') {
    return { name: label, color: null, description: null };
  }
  return {
    name: label.name ?? 'label',
    color: label.color ?? null,
    description: label.description ?? null,
  };
}

function mapIssueUser(user: { login?: string; avatar_url?: string | null } | null | undefined): GithubIssueUserRef | null {
  if (!user?.login) return null;
  return { login: user.login, avatarUrl: user.avatar_url ?? null };
}

function mapIssue(issue: OctokitIssue | OctokitIssueDetail, accountId: number): GithubIssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state as GithubIssueSummary['state'],
    author: issue.user?.login ?? 'unknown',
    labels: issue.labels.map((label) => mapIssueLabel(label as OctokitIssueLabel)),
    assignees: (issue.assignees ?? [])
      .map((user) => mapIssueUser(user))
      .filter((user): user is GithubIssueUserRef => user != null),
    url: issue.html_url,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at ?? null,
    commentsCount: issue.comments ?? 0,
    accountId,
  };
}

function mapIssueComment(comment: OctokitIssueComment): GithubIssueDetail['comments'][number] {
  return {
    id: comment.id,
    author: comment.user?.login ?? 'unknown',
    body: comment.body ?? '',
    url: comment.html_url,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
  };
}

export async function listIssues(
  accountId: number,
  owner: string,
  repo: string,
  state: GithubIssueStateFilter = 'open',
): Promise<GithubIssueSummary[]> {
  const client = mustClient(accountId);
  const res = await client.issues.listForRepo({
    owner,
    repo,
    state,
    per_page: 50,
    sort: 'updated',
    direction: 'desc',
  });
  return res.data
    .filter((issue) => !issue.pull_request)
    .map((issue) => mapIssue(issue, accountId));
}

export async function getIssueDetail(
  accountId: number,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubIssueDetail> {
  const client = mustClient(accountId);
  const [{ data }, comments] = await Promise.all([
    client.issues.get({ owner, repo, issue_number: issueNumber }),
    client.paginate(client.issues.listComments, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    }) as Promise<OctokitIssueComment[]>,
  ]);
  if ('pull_request' in data && data.pull_request) {
    throw new Error(`GitHub #${issueNumber} is a pull request, not an issue.`);
  }
  return {
    ...mapIssue(data, accountId),
    body: data.body ?? '',
    comments: comments.map(mapIssueComment),
  };
}

export async function listCheckRuns(
  accountId: number,
  owner: string,
  repo: string,
  ref: string,
): Promise<GithubCheckRun[]> {
  const client = mustClient(accountId);
  const res = await client.checks.listForRef({ owner, repo, ref, per_page: 50 });
  return res.data.check_runs.map((run) => ({
    id: run.id,
    name: run.name,
    status: (run.status ?? 'queued') as GithubCheckRun['status'],
    conclusion: (run.conclusion ?? null) as GithubCheckRun['conclusion'],
    detailsUrl: run.details_url ?? null,
    startedAt: run.started_at ?? null,
    completedAt: run.completed_at ?? null,
  }));
}

export async function submitReview(
  accountId: number,
  owner: string,
  repo: string,
  input: GithubSubmitReviewInput,
): Promise<void> {
  const client = mustClient(accountId);
  await client.pulls.createReview({
    owner,
    repo,
    pull_number: input.prNumber,
    event: input.event,
    body: input.body,
    comments: input.comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side,
      start_line: c.startLine,
      start_side: c.startSide,
      body: c.body,
    })),
  });
}

interface OctokitRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string } | null;
  private: boolean;
  fork: boolean;
  archived?: boolean;
  description: string | null;
  default_branch?: string;
  clone_url?: string;
  ssh_url?: string;
  html_url: string;
  stargazers_count?: number;
  updated_at: string | null;
}

function mapRepo(r: OctokitRepo, account: GithubAccount): GithubRepoSummary {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    ownerLogin: r.owner?.login ?? r.full_name.split('/')[0] ?? '',
    private: r.private,
    fork: r.fork,
    archived: !!r.archived,
    description: r.description,
    defaultBranch: r.default_branch ?? null,
    cloneUrl: r.clone_url ?? `https://github.com/${r.full_name}.git`,
    sshUrl: r.ssh_url ?? `git@github.com:${r.full_name}.git`,
    htmlUrl: r.html_url,
    stargazersCount: r.stargazers_count ?? 0,
    updatedAt: r.updated_at ?? '',
    accountId: account.id,
    accountLogin: account.login,
    accountAvatarUrl: account.avatarUrl,
  };
}

export async function listAllRepos(): Promise<GithubRepoSummary[]> {
  ensureLoaded();
  await maybeMigrateLegacyToken();
  const all: GithubRepoSummary[] = [];
  await Promise.all(
    Array.from(clients.values()).map(async (c) => {
      try {
        const data = await c.octokit.paginate(c.octokit.repos.listForAuthenticatedUser, {
          per_page: 100,
          sort: 'updated',
          direction: 'desc',
          affiliation: 'owner,collaborator,organization_member',
        });
        for (const r of data as OctokitRepo[]) {
          all.push(mapRepo(r, c.account));
        }
      } catch {
        // Skip this account silently — the UI surfaces auth issues via the account row itself.
      }
    }),
  );
  return all;
}

export async function listMyOrgs(accountId: number): Promise<GithubOwnerRef[]> {
  const client = mustClient(accountId);
  const orgs = (await client.paginate(client.orgs.listForAuthenticatedUser, {
    per_page: 100,
  })) as { login: string; avatar_url: string | null }[];
  return orgs.map((o) => ({
    login: o.login,
    kind: 'org',
    avatarUrl: o.avatar_url ?? null,
  }));
}

export async function listOrgRepos(accountId: number, org: string): Promise<GithubRepoSummary[]> {
  const client = mustClient(accountId);
  const c = clients.get(accountId);
  if (!c) throw new Error(`Account ${accountId} not loaded`);
  const data = await client.paginate(client.repos.listForOrg, {
    org,
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
    type: 'all',
  });
  return (data as OctokitRepo[]).map((r) => mapRepo(r, c.account));
}
