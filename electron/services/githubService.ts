import { Octokit } from '@octokit/rest';
import { safeStorage } from 'electron';
import { getSetting, setSetting, deleteSetting } from './db';
import type {
  GithubAuthState,
  GithubCheckRun,
  GithubOwnerRef,
  GithubPullRequestDetail,
  GithubPullRequestSummary,
  GithubRepoSummary,
  GithubSubmitReviewInput,
} from '../../shared/types';

const TOKEN_KEY = 'github_token_encrypted';
const TOKEN_PLAIN_KEY = 'github_token_plain';

function loadStoredToken(): string | null {
  if (safeStorage.isEncryptionAvailable()) {
    const enc = getSetting(TOKEN_KEY);
    if (!enc) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  }
  return getSetting(TOKEN_PLAIN_KEY);
}

function storeToken(token: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(token).toString('base64');
    setSetting(TOKEN_KEY, enc);
    deleteSetting(TOKEN_PLAIN_KEY);
  } else {
    setSetting(TOKEN_PLAIN_KEY, token);
    deleteSetting(TOKEN_KEY);
  }
}

function clearToken(): void {
  deleteSetting(TOKEN_KEY);
  deleteSetting(TOKEN_PLAIN_KEY);
}

let octokit: Octokit | null = null;
let cachedLogin: string | null = null;
let cachedScopes: string[] = [];

function getOctokit(): Octokit | null {
  if (octokit) return octokit;
  const token = loadStoredToken();
  if (!token) return null;
  octokit = new Octokit({ auth: token, userAgent: 'differ-mvp' });
  return octokit;
}

export async function setToken(token: string): Promise<GithubAuthState> {
  storeToken(token);
  octokit = null;
  cachedLogin = null;
  cachedScopes = [];
  return getAuthStatus(true);
}

export async function clearAuth(): Promise<GithubAuthState> {
  clearToken();
  octokit = null;
  cachedLogin = null;
  cachedScopes = [];
  return { authenticated: false, login: null, scopes: [] };
}

export async function getAuthStatus(force = false): Promise<GithubAuthState> {
  const client = getOctokit();
  if (!client) return { authenticated: false, login: null, scopes: [] };
  if (cachedLogin && !force) {
    return { authenticated: true, login: cachedLogin, scopes: cachedScopes };
  }
  try {
    const res = await client.request('GET /user');
    cachedLogin = (res.data as { login: string }).login;
    const scopeHeader = res.headers['x-oauth-scopes'] as string | undefined;
    cachedScopes = scopeHeader ? scopeHeader.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return { authenticated: true, login: cachedLogin, scopes: cachedScopes };
  } catch {
    return { authenticated: false, login: null, scopes: [] };
  }
}

export async function listPullRequests(owner: string, repo: string): Promise<GithubPullRequestSummary[]> {
  const client = mustClient();
  const res = await client.pulls.list({ owner, repo, state: 'open', per_page: 50, sort: 'updated', direction: 'desc' });
  return res.data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.merged_at ? 'merged' : (pr.state as 'open' | 'closed'),
    isDraft: !!pr.draft,
    author: pr.user?.login ?? 'unknown',
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    url: pr.html_url,
    updatedAt: pr.updated_at,
    reviewDecision: null,
  }));
}

export async function getPullRequestDetail(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GithubPullRequestDetail> {
  const client = mustClient();
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
  };
}

export async function listCheckRuns(
  owner: string,
  repo: string,
  ref: string,
): Promise<GithubCheckRun[]> {
  const client = mustClient();
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
  owner: string,
  repo: string,
  input: GithubSubmitReviewInput,
): Promise<void> {
  const client = mustClient();
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

function mustClient(): Octokit {
  const c = getOctokit();
  if (!c) throw new Error('GitHub is not authenticated. Add a personal access token in Settings.');
  return c;
}

export function getStoredToken(): string | null {
  return loadStoredToken();
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

function mapRepo(r: OctokitRepo): GithubRepoSummary {
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
  };
}

export async function listMyRepos(): Promise<GithubRepoSummary[]> {
  const client = mustClient();
  const data = await client.paginate(client.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
    affiliation: 'owner,collaborator,organization_member',
  });
  return (data as OctokitRepo[]).map(mapRepo);
}

export async function listMyOrgs(): Promise<GithubOwnerRef[]> {
  const client = mustClient();
  const orgs = (await client.paginate(client.orgs.listForAuthenticatedUser, {
    per_page: 100,
  })) as { login: string; avatar_url: string | null }[];
  return orgs.map((o) => ({
    login: o.login,
    kind: 'org',
    avatarUrl: o.avatar_url ?? null,
  }));
}

export async function listOrgRepos(org: string): Promise<GithubRepoSummary[]> {
  const client = mustClient();
  const data = await client.paginate(client.repos.listForOrg, {
    org,
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
    type: 'all',
  });
  return (data as OctokitRepo[]).map(mapRepo);
}
