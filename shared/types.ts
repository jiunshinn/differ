// Shared types between main and renderer. These flow over IPC.

export interface Repository {
  id: number;
  path: string;
  name: string;
  default_branch: string | null;
  remote_url: string | null;
  github_owner: string | null;
  github_repo: string | null;
  created_at: string;
  last_opened_at: string;
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
export type CommentLabel = 'issue' | 'question' | 'refactor' | 'test' | 'ask-ai' | null;

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

export interface ContextBundle {
  id: number;
  review_session_id: number;
  title: string;
  task: string;
  included_comments_json: string;
  included_files_json: string;
  included_hunks_json: string;
  output_markdown: string;
  created_at: string;
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

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

// GitHub wire types

export interface GithubPullRequestSummary {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  url: string;
  updatedAt: string;
  reviewDecision: string | null;
}

export interface GithubPullRequestDetail extends GithubPullRequestSummary {
  body: string;
  mergeable: boolean | null;
  changedFiles: number;
  additions: number;
  deletions: number;
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
}

// Context extraction

export interface ContextExtractionInput {
  sessionId: number;
  task: string;
  testCommand?: string;
  includeRepoMetadata: boolean;
  includeFullFiles: boolean;
  commentIds: number[];
  filePaths: string[];
  // Specific hunks identified by file + hunk header.
  hunks: { filePath: string; hunkHeader: string }[];
}

export interface ContextExtractionResult {
  markdown: string;
}

// Auth

export interface GithubAuthState {
  authenticated: boolean;
  login: string | null;
  scopes: string[];
}

// IPC channels (used as a const map so renderer + main stay in sync)

export const IpcChannels = {
  // Repo lifecycle
  repoOpen: 'repo:open',
  repoPick: 'repo:pick',
  repoRecent: 'repo:recent',
  repoRemove: 'repo:remove',
  repoStatus: 'repo:status',
  repoBranches: 'repo:branches',
  repoCommits: 'repo:commits',
  repoFetch: 'repo:fetch',
  repoPull: 'repo:pull',
  repoPush: 'repo:push',
  repoCheckout: 'repo:checkout',
  repoCreateBranch: 'repo:createBranch',
  repoStageFile: 'repo:stageFile',
  repoUnstageFile: 'repo:unstageFile',
  repoStageHunk: 'repo:stageHunk',
  repoUnstageHunk: 'repo:unstageHunk',
  repoDiscardFile: 'repo:discardFile',
  repoCommit: 'repo:commit',
  repoAmend: 'repo:amend',

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
  fileStateGet: 'fileState:get',
  fileStateSet: 'fileState:set',
  fileStateList: 'fileState:list',

  // Context bundle
  contextPreview: 'context:preview',
  contextSave: 'context:save',
  contextCopy: 'context:copy',

  // GitHub
  ghAuthStatus: 'gh:authStatus',
  ghAuthSetToken: 'gh:authSetToken',
  ghAuthClear: 'gh:authClear',
  ghPrList: 'gh:prList',
  ghPrDetail: 'gh:prDetail',
  ghPrCheckout: 'gh:prCheckout',
  ghPrSubmitReview: 'gh:prSubmitReview',
  ghPrOpenInBrowser: 'gh:prOpenInBrowser',
  ghPrChecks: 'gh:prChecks',

  // System
  clipboardWrite: 'system:clipboardWrite',
  shellOpenExternal: 'system:shellOpenExternal',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
