// Single source of truth for the IPC bridge surface (window.differ).
//
// Both sides reference this interface:
//   - electron/preload.ts annotates `const api: DifferApi = {...}` so the bridge
//     implementation is type-checked against it.
//   - src/api.ts types `window.differ` with it.
// A signature change here is therefore a compile error in both the preload and
// the renderer, preventing the silent runtime drift that hand-duplication caused.

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
  GithubAccount,
  GithubAuthState,
  GithubCheckRun,
  GithubDeviceCode,
  GithubIssueDetail,
  GithubIssueStateFilter,
  GithubIssueSummary,
  GithubListAllReposResult,
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
  ReviewSession,
  TreeEntry,
} from './types';

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

export type UpdateCommentPatch = Partial<{
  body: string;
  label: CommentLabel;
  status: 'open' | 'resolved';
}>;

// Options for staging/unstaging a single hunk. ignoreWhitespace must match the
// flag used to fetch the diff so the hunk header lines up with the patch.
export interface HunkStageOptions {
  ignoreWhitespace?: boolean;
  staged?: boolean;
}

export interface DifferApi {
  pickRepo: () => Promise<Repository | null>;
  openRepo: (path: string) => Promise<Repository>;
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
  stageHunk: (
    repoId: number,
    filePath: string,
    hunkHeader: string,
    opts?: HunkStageOptions,
  ) => Promise<boolean>;
  unstageHunk: (
    repoId: number,
    filePath: string,
    hunkHeader: string,
    opts?: HunkStageOptions,
  ) => Promise<boolean>;
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
  createComment: (input: CreateCommentInput) => Promise<ReviewComment>;
  updateComment: (id: number, patch: UpdateCommentPatch) => Promise<ReviewComment | null>;
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
  ghListAllRepos: () => Promise<GithubListAllReposResult>;
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

  copyToClipboard: (text: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
}

export type { ChangedFile };
