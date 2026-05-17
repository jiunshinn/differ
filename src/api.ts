import type {
  BranchInfo,
  ChangedFile,
  CommentDiffSide,
  CommentLabel,
  CommentTargetKind,
  CommitSummary,
  ContextExtractionInput,
  ContextExtractionResult,
  FileContent,
  FileDiff,
  FileReviewState,
  FileReviewStatus,
  GithubAuthState,
  GithubCheckRun,
  GithubPullRequestDetail,
  GithubPullRequestSummary,
  GithubSubmitReviewInput,
  RepoStatus,
  Repository,
  ReviewComment,
  ReviewSession,
  TreeEntry,
} from '@shared/types';

// This must match the preload's exposed API exactly. We model it on the renderer side.
export interface DifferApi {
  pickRepo: () => Promise<Repository | null>;
  openRepo: (path: string) => Promise<Repository>;
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

  previewContext: (input: ContextExtractionInput) => Promise<ContextExtractionResult>;
  saveContext: (input: {
    sessionId: number;
    title: string;
    task: string;
    output: string;
    included: { comments: number[]; files: string[]; hunks: { filePath: string; hunkHeader: string }[] };
  }) => Promise<unknown>;
  copyContext: (markdown: string) => Promise<boolean>;

  ghAuthStatus: () => Promise<GithubAuthState>;
  ghAuthSetToken: (token: string) => Promise<GithubAuthState>;
  ghAuthClear: () => Promise<GithubAuthState>;
  ghPrList: (repoId: number) => Promise<GithubPullRequestSummary[]>;
  ghPrDetail: (repoId: number, prNumber: number) => Promise<GithubPullRequestDetail>;
  ghPrCheckout: (repoId: number, prNumber: number) => Promise<ReviewSession>;
  ghPrSubmitReview: (repoId: number, input: GithubSubmitReviewInput) => Promise<boolean>;
  ghPrOpenInBrowser: (repoId: number, prNumber: number) => Promise<boolean>;
  ghPrChecks: (repoId: number, ref: string) => Promise<GithubCheckRun[]>;

  copyToClipboard: (text: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    differ: DifferApi;
  }
}

export const api: DifferApi = (window as unknown as { differ: DifferApi }).differ;

export type { ChangedFile };
