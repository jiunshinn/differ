import type {
  GithubIssueStateFilter,
  GithubPullRequestStateFilter,
} from '@shared/types';

export interface DiffQueryOptions {
  staged?: boolean;
  ignoreWhitespace?: boolean;
  includeUntracked?: boolean;
  base?: string;
  head?: string;
}

function normalizeDiffOptions(opts: DiffQueryOptions) {
  return {
    staged: !!opts.staged,
    ignoreWhitespace: !!opts.ignoreWhitespace,
    includeUntracked: !!opts.includeUntracked,
    base: opts.base ?? null,
    head: opts.head ?? null,
  };
}

export const queryKeys = {
  all: ['differ'] as const,
  repo: {
    all: () => [...queryKeys.all, 'repo'] as const,
    scope: (repoId: number) => [...queryKeys.repo.all(), repoId] as const,
    recent: () => [...queryKeys.repo.all(), 'recent'] as const,
    status: (repoId: number) => [...queryKeys.repo.scope(repoId), 'status'] as const,
    branches: (repoId: number) => [...queryKeys.repo.scope(repoId), 'branches'] as const,
    commits: (repoId: number, limit: number) => [...queryKeys.repo.scope(repoId), 'commits', limit] as const,
    tree: (repoId: number, relDir: string) => [...queryKeys.repo.scope(repoId), 'tree', relDir] as const,
    file: (repoId: number, relPath: string) => [...queryKeys.repo.scope(repoId), 'file', relPath] as const,
  },
  session: {
    all: () => [...queryKeys.all, 'session'] as const,
    local: (repoId: number) => [...queryKeys.session.all(), 'local', repoId] as const,
    detail: (sessionId: number) => [...queryKeys.session.all(), sessionId] as const,
    comments: (sessionId: number) => [...queryKeys.session.detail(sessionId), 'comments'] as const,
    fileStates: (sessionId: number) => [...queryKeys.session.detail(sessionId), 'file-states'] as const,
  },
  diff: {
    all: () => [...queryKeys.all, 'diff'] as const,
    repo: (repoId: number) => [...queryKeys.diff.all(), repoId] as const,
    file: (repoId: number, filePath: string, opts: DiffQueryOptions) =>
      [...queryKeys.diff.repo(repoId), 'file', filePath, normalizeDiffOptions(opts)] as const,
    allFiles: (repoId: number, opts: DiffQueryOptions) =>
      [...queryKeys.diff.repo(repoId), 'all', normalizeDiffOptions(opts)] as const,
  },
  github: {
    all: () => [...queryKeys.all, 'github'] as const,
    auth: () => [...queryKeys.github.all(), 'auth'] as const,
    repos: () => [...queryKeys.github.all(), 'repos'] as const,
    orgs: (accountId: number) => [...queryKeys.github.all(), 'orgs', accountId] as const,
    orgRepos: (accountId: number, org: string) => [...queryKeys.github.all(), 'org-repos', accountId, org] as const,
    repo: (repoId: number) => [...queryKeys.github.all(), 'repo', repoId] as const,
    prs: (repoId: number, state: GithubPullRequestStateFilter) =>
      [...queryKeys.github.repo(repoId), 'prs', state] as const,
    prDetail: (repoId: number, prNumber: number) =>
      [...queryKeys.github.repo(repoId), 'pr', prNumber] as const,
    prChecks: (repoId: number, ref: string) => [...queryKeys.github.repo(repoId), 'checks', ref] as const,
    issues: (repoId: number, state: GithubIssueStateFilter) =>
      [...queryKeys.github.repo(repoId), 'issues', state] as const,
    issueDetail: (repoId: number, issueNumber: number) =>
      [...queryKeys.github.repo(repoId), 'issue', issueNumber] as const,
  },
};
