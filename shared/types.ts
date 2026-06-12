// Shared types between main and renderer. These flow over IPC.
//
// NOTE: Repository / ReviewSession / ReviewComment / FileReviewState below are
// raw SQLite row shapes — snake_case columns, and SQLite's integer-boolean
// convention (e.g. `pinned` is 0 | 1, not a real boolean). The git/GitHub wire
// types further down are camelCase with real booleans. Callers that mutate these
// (e.g. optimistic cache updates) must respect the 0/1 convention. A future
// cleanup should map rows to camelCase wire objects at the electron store
// boundary (mirroring githubService's rowToAccount) so the DB schema stops
// leaking into the IPC/UI contract; that work lives in electron/services and is
// tracked separately.

export interface Repository {
  id: number;
  path: string;
  name: string;
  default_branch: string | null;
  remote_url: string | null;
  github_owner: string | null;
  github_repo: string | null;
  github_account_id: number | null;
  created_at: string;
  last_opened_at: string;
  /** SQLite boolean: 0 = unpinned, 1 = pinned. */
  pinned: number;
  sort_order: number;
}

export type ReviewSessionKind = 'local' | 'pull_request';

export interface ReviewSession {
  id: number;
  repository_id: number;
  kind: ReviewSessionKind;
  branch: string | null;
  base_branch: string | null;
  head_sha: string | null;
  base_sha: string | null;
  github_pr_number: number | null;
  created_at: string;
  updated_at: string;
}

export type CommentTargetKind = 'file' | 'line' | 'hunk';
export type CommentDiffSide = 'old' | 'new' | 'none';
export type CommentStatus = 'open' | 'resolved';
export type CommentLabel = 'issue' | 'question' | 'refactor' | 'test' | null;

export interface ReviewComment {
  id: number;
  review_session_id: number;
  file_path: string;
  target_kind: CommentTargetKind;
  diff_side: CommentDiffSide;
  line_number: number | null;
  hunk_header: string | null;
  body: string;
  label: CommentLabel;
  status: CommentStatus;
  created_at: string;
  updated_at: string;
}

export type FileReviewStatus = 'unviewed' | 'viewed' | 'reviewed';

export interface FileReviewState {
  id: number;
  review_session_id: number;
  file_path: string;
  status: FileReviewStatus;
  updated_at: string;
}

// Git wire types

export type WorkingTreeGroup = 'unstaged' | 'staged' | 'untracked' | 'conflicted';

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  group: WorkingTreeGroup;
  // Single-letter codes from `git status --porcelain` (XY).
  indexStatus: string;
  worktreeStatus: string;
  // True if the file is renamed.
  renamed: boolean;
}

export interface RepoStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  files: ChangedFile[];
  rebaseInProgress: boolean;
  mergeInProgress: boolean;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface FileDiff {
  filePath: string;
  oldPath: string | null;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  hunks: DiffHunk[];
}

export interface DiffOptions {
  staged?: boolean;
  // Compare against a specific ref instead of HEAD or staged.
  base?: string;
  head?: string;
  ignoreWhitespace?: boolean;
  filePath?: string;
  // For untracked files: synthesize an additive diff against /dev/null.
  includeUntracked?: boolean;
}

// File tree

export type TreeEntryKind = 'dir' | 'file';

export interface TreeEntry {
  name: string;
  path: string; // repo-relative, forward slashes
  kind: TreeEntryKind;
}

export interface FileContent {
  path: string;
  text: string | null; // null when binary or unreadable
  isBinary: boolean;
  size: number;
  truncated: boolean;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

// GitHub wire types

export type GithubPullRequestState = 'open' | 'closed' | 'merged';
export type GithubPullRequestStateFilter = GithubPullRequestState | 'all';

export interface GithubPullRequestSummary {
  number: number;
  title: string;
  state: GithubPullRequestState;
  isDraft: boolean;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  url: string;
  updatedAt: string;
  reviewDecision: string | null;
  accountId: number;
}

export interface GithubPullRequestDetail extends GithubPullRequestSummary {
  body: string;
  mergeable: boolean | null;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export type GithubIssueState = 'open' | 'closed';
export type GithubIssueStateFilter = GithubIssueState | 'all';

export interface GithubIssueLabel {
  name: string;
  color: string | null;
  description: string | null;
}

export interface GithubIssueUserRef {
  login: string;
  avatarUrl: string | null;
}

export interface GithubIssueSummary {
  number: number;
  title: string;
  state: GithubIssueState;
  author: string;
  labels: GithubIssueLabel[];
  assignees: GithubIssueUserRef[];
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  commentsCount: number;
  accountId: number;
}

export interface GithubIssueComment {
  id: number;
  author: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubIssueDetail extends GithubIssueSummary {
  body: string;
  comments: GithubIssueComment[];
}

export type GithubCheckStatus = 'queued' | 'in_progress' | 'completed';
export type GithubCheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'stale'
  | null;

export interface GithubCheckRun {
  id: number;
  name: string;
  status: GithubCheckStatus;
  conclusion: GithubCheckConclusion;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type GithubReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export interface GithubReviewCommentInput {
  path: string;
  // Line in the new file the comment refers to. For multi-line, pass startLine.
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
}

export interface GithubSubmitReviewInput {
  prNumber: number;
  event: GithubReviewEvent;
  body: string;
  comments: GithubReviewCommentInput[];
  // The head sha the diff was reviewed against, so review comments anchor to the
  // reviewed commit even if the PR head advances before submission.
  commitId?: string;
}

// Auth

export interface GithubAccount {
  id: number;
  login: string;
  avatarUrl: string | null;
  scopes: string[];
  addedAt: string;
  // Set when the stored token failed to authenticate (revoked/expired): the
  // account stays visible so the user can re-auth instead of it silently vanishing.
  needsReauth?: boolean;
  // Set when the token had to be persisted unencrypted (safeStorage unavailable),
  // so the UI can warn the user.
  tokenStoredPlaintext?: boolean;
}

export interface GithubAuthState {
  accounts: GithubAccount[];
}

export interface GithubOAuthConfig {
  configured: boolean;
  clientIdPresent: boolean;
  scopes: string[];
}

export interface GithubDeviceCode {
  // The secret device_code is intentionally NOT included — it stays in the main
  // process; the renderer only needs the user-facing code and verification URL.
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GithubListAllReposResult {
  repos: GithubRepoSummary[];
  errors: { accountId: number; login: string; message: string }[];
}

export type GithubOAuthPollStatus =
  | 'pending'
  | 'slow_down'
  | 'authorized'
  | 'expired'
  | 'denied'
  | 'error';

export interface GithubOAuthPollResult {
  status: GithubOAuthPollStatus;
  account?: GithubAccount;
  error?: string;
  nextIntervalSeconds?: number;
}

// GitHub repo listing (for the in-app browser)

export interface GithubOwnerRef {
  login: string;
  kind: 'user' | 'org';
  avatarUrl: string | null;
}

export interface GithubRepoSummary {
  id: number;
  name: string;
  fullName: string; // owner/name
  ownerLogin: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  defaultBranch: string | null;
  cloneUrl: string; // https
  sshUrl: string;
  htmlUrl: string;
  stargazersCount: number;
  updatedAt: string;
  accountId: number;
  accountLogin: string;
  accountAvatarUrl: string | null;
}

// Clone

export interface CloneRequest {
  remoteUrl: string;
  parentDir: string;
  folderName?: string; // defaults to repo slug derived from URL
  useAuthToken?: boolean; // attach the stored GitHub token for HTTPS github.com URLs
  // The account that discovered/owns this repo. When set, its token is used
  // for the clone, and the cloned row is bound to this account.
  accountId?: number;
}

// IPC channels (used as a const map so renderer + main stay in sync)

export const IpcChannels = {
  // Repo lifecycle
  repoOpen: 'repo:open',
  repoPick: 'repo:pick',
  repoRecent: 'repo:recent',
  repoRemove: 'repo:remove',
  repoSetPinned: 'repo:setPinned',
  repoReorder: 'repo:reorder',
  repoStatus: 'repo:status',
  repoBranches: 'repo:branches',
  repoCommits: 'repo:commits',
  repoFetch: 'repo:fetch',
  repoPull: 'repo:pull',
  repoPush: 'repo:push',
  repoSync: 'repo:sync',
  repoRebaseContinue: 'repo:rebaseContinue',
  repoRebaseAbort: 'repo:rebaseAbort',
  repoMergeAbort: 'repo:mergeAbort',
  repoCheckout: 'repo:checkout',
  repoCreateBranch: 'repo:createBranch',
  repoStageFile: 'repo:stageFile',
  repoUnstageFile: 'repo:unstageFile',
  repoStageHunk: 'repo:stageHunk',
  repoUnstageHunk: 'repo:unstageHunk',
  repoDiscardFile: 'repo:discardFile',
  repoCommit: 'repo:commit',
  repoAmend: 'repo:amend',
  repoListTree: 'repo:listTree',
  repoReadFile: 'repo:readFile',
  repoClone: 'repo:clone',
  repoPickDirectory: 'repo:pickDirectory',

  // Diff
  diffFile: 'diff:file',
  diffAll: 'diff:all',

  // Sessions
  sessionEnsureLocal: 'session:ensureLocal',
  sessionEnsurePr: 'session:ensurePr',
  sessionGet: 'session:get',

  // Comments
  commentList: 'comment:list',
  commentCreate: 'comment:create',
  commentUpdate: 'comment:update',
  commentDelete: 'comment:delete',

  // File review state
  fileStateSet: 'fileState:set',
  fileStateList: 'fileState:list',

  // GitHub
  ghAuthList: 'gh:authList',
  ghAuthAddToken: 'gh:authAddToken',
  ghAuthRemove: 'gh:authRemove',
  ghAuthListReposForAccount: 'gh:authListReposForAccount',
  ghAuthRebindRepos: 'gh:authRebindRepos',
  ghAuthSetRepoAccount: 'gh:authSetRepoAccount',
  ghPrList: 'gh:prList',
  ghPrDetail: 'gh:prDetail',
  ghPrCheckout: 'gh:prCheckout',
  ghPrSubmitReview: 'gh:prSubmitReview',
  ghPrOpenInBrowser: 'gh:prOpenInBrowser',
  ghPrChecks: 'gh:prChecks',
  ghIssueList: 'gh:issueList',
  ghIssueDetail: 'gh:issueDetail',
  ghIssueOpenInBrowser: 'gh:issueOpenInBrowser',
  ghOauthConfig: 'gh:oauthConfig',
  ghOauthStart: 'gh:oauthStart',
  ghOauthPoll: 'gh:oauthPoll',
  ghOauthCancel: 'gh:oauthCancel',
  ghListAllRepos: 'gh:listAllRepos',
  ghListMyOrgs: 'gh:listMyOrgs',
  ghListOrgRepos: 'gh:listOrgRepos',

  // System
  clipboardWrite: 'system:clipboardWrite',
  shellOpenExternal: 'system:shellOpenExternal',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
