import type {
  BranchInfo,
  ChangedFile,
  CloneRequest,
  CommentDiffSide,
  CommentLabel,
  CommentTargetKind,
  CommitSummary,
  FileContent,
  FileDiff,
  FileReviewState,
  FileReviewStatus,
  FsBrowseListing,
  GithubAccount,
  GithubAuthState,
  GithubCheckRun,
  GithubDeviceCode,
  GithubIssueDetail,
  GithubIssueStateFilter,
  GithubIssueSummary,
  GithubOAuthConfig,
  GithubOAuthPollResult,
  GithubOwnerRef,
  GithubPullRequestDetail,
  GithubPullRequestStateFilter,
  GithubPullRequestSummary,
  GithubRepoSummary,
  GithubSubmitReviewInput,
  RepoStatus,
  Repository,
  ReviewComment,
  Environment,
  EnvironmentCheck,
  EnvironmentDraft,
  EnvironmentList,
  ReviewSession,
  ServerEndpoint,
  TreeEntry,
} from '@shared/types';

// This must match the preload's exposed API exactly. We model it on the renderer side.
export interface DifferApi {
  pickRepo: () => Promise<Repository | null>;
  openRepo: (path: string) => Promise<Repository>;
  openRepoInEnvironment: (environmentId: string, path: string) => Promise<Repository>;
  listDir: (environmentId: string | null, path: string | null) => Promise<FsBrowseListing>;
  pickDirectory: (title?: string) => Promise<string | null>;
  cloneRepo: (req: CloneRequest) => Promise<Repository>;
  recentRepos: () => Promise<Repository[]>;
  removeRecent: (id: number) => Promise<boolean>;
  setRepoPinned: (id: number, pinned: boolean) => Promise<Repository | null>;
  reorderRepos: (orderedIds: number[]) => Promise<boolean>;
  status: (repoId: number) => Promise<RepoStatus>;
  branches: (repoId: number) => Promise<BranchInfo[]>;
  commits: (repoId: number, limit?: number) => Promise<CommitSummary[]>;
  fetch: (repoId: number) => Promise<boolean>;
  pull: (repoId: number, opts?: { rebase?: boolean }) => Promise<boolean>;
  push: (repoId: number, opts?: { setUpstream?: boolean }) => Promise<boolean>;
  sync: (repoId: number) => Promise<boolean>;
  rebaseContinue: (repoId: number) => Promise<boolean>;
  rebaseAbort: (repoId: number) => Promise<boolean>;
  mergeAbort: (repoId: number) => Promise<boolean>;
  checkout: (repoId: number, branch: string) => Promise<boolean>;
  createBranch: (repoId: number, branch: string, checkout: boolean) => Promise<boolean>;
  stageFile: (repoId: number, filePath: string) => Promise<boolean>;
  unstageFile: (repoId: number, filePath: string) => Promise<boolean>;
  stageHunk: (repoId: number, filePath: string, hunkHeader: string) => Promise<boolean>;
  unstageHunk: (repoId: number, filePath: string, hunkHeader: string) => Promise<boolean>;
  discardFile: (repoId: number, filePath: string) => Promise<boolean>;
  commit: (repoId: number, message: string) => Promise<boolean>;
  amend: (repoId: number, message: string | null) => Promise<boolean>;
  listTree: (repoId: number, relDir?: string) => Promise<TreeEntry[]>;
  readFile: (repoId: number, relPath: string) => Promise<FileContent>;

  fileDiff: (
    repoId: number,
    filePath: string,
    opts: { staged?: boolean; ignoreWhitespace?: boolean; includeUntracked?: boolean; base?: string; head?: string },
  ) => Promise<FileDiff | null>;
  allDiff: (
    repoId: number,
    opts: { staged?: boolean; ignoreWhitespace?: boolean; base?: string; head?: string },
  ) => Promise<FileDiff[]>;

  ensureLocalSession: (repoId: number) => Promise<ReviewSession>;
  ensurePrSession: (
    repoId: number,
    prNumber: number,
    headSha: string,
    baseSha: string,
    branch: string,
    baseBranch: string,
  ) => Promise<ReviewSession>;
  getSession: (sessionId: number) => Promise<ReviewSession | null>;

  listComments: (sessionId: number) => Promise<ReviewComment[]>;
  createComment: (input: {
    review_session_id: number;
    file_path: string;
    target_kind: CommentTargetKind;
    diff_side: CommentDiffSide;
    line_number: number | null;
    hunk_header: string | null;
    body: string;
    label: CommentLabel;
  }) => Promise<ReviewComment>;
  updateComment: (
    id: number,
    patch: Partial<{ body: string; label: CommentLabel; status: 'open' | 'resolved' }>,
  ) => Promise<ReviewComment | null>;
  deleteComment: (id: number) => Promise<boolean>;

  getFileStates: (sessionId: number) => Promise<FileReviewState[]>;
  setFileState: (sessionId: number, filePath: string, status: FileReviewStatus) => Promise<FileReviewState>;

  ghAuthList: () => Promise<GithubAuthState>;
  ghAuthAddToken: (token: string) => Promise<GithubAccount>;
  ghAuthRemove: (accountId: number) => Promise<GithubAuthState>;
  ghAuthListReposForAccount: (accountId: number) => Promise<Repository[]>;
  ghAuthRebindRepos: (fromAccountId: number, toAccountId: number | null) => Promise<number>;
  ghAuthSetRepoAccount: (repoId: number, accountId: number | null) => Promise<Repository | null>;
  ghOauthConfig: () => Promise<GithubOAuthConfig>;
  ghOauthStart: () => Promise<GithubDeviceCode>;
  ghOauthPoll: () => Promise<GithubOAuthPollResult>;
  ghOauthCancel: () => Promise<boolean>;
  ghListAllRepos: () => Promise<GithubRepoSummary[]>;
  ghListMyOrgs: (accountId: number) => Promise<GithubOwnerRef[]>;
  ghListOrgRepos: (accountId: number, org: string) => Promise<GithubRepoSummary[]>;
  ghPrList: (repoId: number, state?: GithubPullRequestStateFilter) => Promise<GithubPullRequestSummary[]>;
  ghPrDetail: (repoId: number, prNumber: number) => Promise<GithubPullRequestDetail>;
  ghPrCheckout: (repoId: number, prNumber: number) => Promise<ReviewSession>;
  ghPrSubmitReview: (repoId: number, input: GithubSubmitReviewInput) => Promise<boolean>;
  ghPrOpenInBrowser: (repoId: number, prNumber: number) => Promise<boolean>;
  ghPrChecks: (repoId: number, ref: string) => Promise<GithubCheckRun[]>;
  ghIssueList: (repoId: number, state?: GithubIssueStateFilter) => Promise<GithubIssueSummary[]>;
  ghIssueDetail: (repoId: number, issueNumber: number) => Promise<GithubIssueDetail>;
  ghIssueOpenInBrowser: (repoId: number, issueNumber: number) => Promise<boolean>;

  serverEndpoint: (envId?: string) => Promise<ServerEndpoint>;

  envList: () => Promise<EnvironmentList>;
  envSave: (draft: EnvironmentDraft) => Promise<Environment>;
  envDelete: (id: string) => Promise<EnvironmentList>;
  envActivate: (id: string) => Promise<ServerEndpoint>;
  envDisconnect: (id: string) => Promise<string[]>;
  envCheck: (id: string) => Promise<EnvironmentCheck>;
  envBootstrap: (id: string) => Promise<EnvironmentCheck>;

  copyToClipboard: (text: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    differ: DifferApi;
  }
}

/**
 * Outside Electron (a plain browser during development), only the agent server is reachable.
 * Open the renderer with ?server=ws://127.0.0.1:PORT&token=TOKEN to connect to a running server.
 */
function browserApi(): DifferApi {
  const params = new URLSearchParams(window.location.search);
  const local: Partial<DifferApi> = {
    serverEndpoint: async () => {
      const url = params.get('server');
      const token = params.get('token');
      if (!url || !token) throw new Error('Add ?server=…&token=… to the URL to connect to a differ server');
      return { url, token };
    },
    recentRepos: async () => [],
    envList: async () =>
      ({
        activeId: 'local',
        connectedIds: ['local'],
        environments: [
          {
            id: 'local',
            name: 'This machine',
            kind: 'local',
            host: '',
            port: 22,
            remoteDir: '',
            command: '',
            createdAt: new Date().toISOString(),
          },
        ],
      }) as EnvironmentList,
    envSave: async () => {
      throw new Error('Environments can only be added in the desktop app');
    },
    envDelete: async () => {
      throw new Error('Environments can only be changed in the desktop app');
    },
    envActivate: async () => {
      throw new Error('Environments can only be switched in the desktop app');
    },
    envDisconnect: async () => [],
    envCheck: async () => ({ ok: false, detail: 'Only available in the desktop app' }),
    envBootstrap: async () => ({ ok: false, detail: 'Only available in the desktop app' }),
    pickDirectory: async () => window.prompt('Folder path on the server host') || null,
    openRepoInEnvironment: async () => {
      throw new Error('Opening a project from another machine is only available in the desktop app');
    },
    listDir: async () => {
      throw new Error('Folder browsing is only available in the desktop app');
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener');
      return true;
    },
  };
  return new Proxy(local as DifferApi, {
    get: (target, key: string) =>
      key in target ? target[key as keyof DifferApi] : () => Promise.reject(new Error(`${key} is only available in the desktop app`)),
  });
}

export const api: DifferApi = (window as unknown as { differ?: DifferApi }).differ ?? browserApi();

export type { ChangedFile };
