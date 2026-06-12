import { contextBridge, ipcRenderer } from 'electron';
import type {
  CloneRequest,
  FileReviewStatus,
  GithubIssueStateFilter,
  GithubPullRequestStateFilter,
  GithubSubmitReviewInput,
} from '../shared/types';
import type { CreateCommentInput, DifferApi, HunkStageOptions, UpdateCommentPatch } from '../shared/api';

// IpcChannels is inlined here (not imported from ../shared/types) on purpose:
// the preload runs in a sandboxed context (webPreferences.sandbox: true) where
// require()-ing a local module at runtime is not available. Keep these string
// values byte-for-byte in sync with shared/types.ts IpcChannels.
const Channels = {
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

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: DifferApi = {
  // Repo
  pickRepo: () => invoke(Channels.repoPick),
  openRepo: (path: string) => invoke(Channels.repoOpen, path),
  pickDirectory: (title?: string) => invoke(Channels.repoPickDirectory, title),
  cloneRepo: (req: CloneRequest) => invoke(Channels.repoClone, req),
  recentRepos: () => invoke(Channels.repoRecent),
  removeRecent: (id: number) => invoke(Channels.repoRemove, id),
  setRepoPinned: (id: number, pinned: boolean) => invoke(Channels.repoSetPinned, id, pinned),
  reorderRepos: (orderedIds: number[]) => invoke(Channels.repoReorder, orderedIds),
  status: (repoId: number) => invoke(Channels.repoStatus, repoId),
  branches: (repoId: number) => invoke(Channels.repoBranches, repoId),
  commits: (repoId: number, limit?: number) => invoke(Channels.repoCommits, repoId, limit),
  fetch: (repoId: number) => invoke(Channels.repoFetch, repoId),
  pull: (repoId: number, opts?: { rebase?: boolean }) => invoke(Channels.repoPull, repoId, opts),
  push: (repoId: number, opts?: { setUpstream?: boolean }) => invoke(Channels.repoPush, repoId, opts),
  sync: (repoId: number) => invoke(Channels.repoSync, repoId),
  rebaseContinue: (repoId: number) => invoke(Channels.repoRebaseContinue, repoId),
  rebaseAbort: (repoId: number) => invoke(Channels.repoRebaseAbort, repoId),
  mergeAbort: (repoId: number) => invoke(Channels.repoMergeAbort, repoId),
  checkout: (repoId: number, branch: string) => invoke(Channels.repoCheckout, repoId, branch),
  createBranch: (repoId: number, branch: string, checkout: boolean) =>
    invoke(Channels.repoCreateBranch, repoId, branch, checkout),
  stageFile: (repoId: number, filePath: string) => invoke(Channels.repoStageFile, repoId, filePath),
  unstageFile: (repoId: number, filePath: string) => invoke(Channels.repoUnstageFile, repoId, filePath),
  stageHunk: (repoId: number, filePath: string, hunkHeader: string, opts?: HunkStageOptions) =>
    invoke(Channels.repoStageHunk, repoId, filePath, hunkHeader, opts),
  unstageHunk: (repoId: number, filePath: string, hunkHeader: string, opts?: HunkStageOptions) =>
    invoke(Channels.repoUnstageHunk, repoId, filePath, hunkHeader, opts),
  discardFile: (repoId: number, filePath: string) => invoke(Channels.repoDiscardFile, repoId, filePath),
  commit: (repoId: number, message: string) => invoke(Channels.repoCommit, repoId, message),
  amend: (repoId: number, message: string | null) => invoke(Channels.repoAmend, repoId, message),
  listTree: (repoId: number, relDir?: string) => invoke(Channels.repoListTree, repoId, relDir ?? ''),
  readFile: (repoId: number, relPath: string) => invoke(Channels.repoReadFile, repoId, relPath),

  // Diff
  fileDiff: (
    repoId: number,
    filePath: string,
    opts: { staged?: boolean; ignoreWhitespace?: boolean; includeUntracked?: boolean; base?: string; head?: string },
  ) => invoke(Channels.diffFile, repoId, filePath, opts),
  allDiff: (
    repoId: number,
    opts: { staged?: boolean; ignoreWhitespace?: boolean; base?: string; head?: string },
  ) => invoke(Channels.diffAll, repoId, opts),

  // Sessions
  ensureLocalSession: (repoId: number) => invoke(Channels.sessionEnsureLocal, repoId),
  ensurePrSession: (repoId: number, prNumber: number, headSha: string, baseSha: string, branch: string, baseBranch: string) =>
    invoke(Channels.sessionEnsurePr, repoId, prNumber, headSha, baseSha, branch, baseBranch),
  getSession: (sessionId: number) => invoke(Channels.sessionGet, sessionId),

  // Comments
  listComments: (sessionId: number) => invoke(Channels.commentList, sessionId),
  createComment: (input: CreateCommentInput) => invoke(Channels.commentCreate, input),
  updateComment: (id: number, patch: UpdateCommentPatch) => invoke(Channels.commentUpdate, id, patch),
  deleteComment: (id: number) => invoke(Channels.commentDelete, id),

  // File review state
  getFileStates: (sessionId: number) => invoke(Channels.fileStateList, sessionId),
  setFileState: (sessionId: number, filePath: string, status: FileReviewStatus) =>
    invoke(Channels.fileStateSet, sessionId, filePath, status),

  // GitHub
  ghAuthList: () => invoke(Channels.ghAuthList),
  ghAuthAddToken: (token: string) => invoke(Channels.ghAuthAddToken, token),
  ghAuthRemove: (accountId: number) => invoke(Channels.ghAuthRemove, accountId),
  ghAuthListReposForAccount: (accountId: number) =>
    invoke(Channels.ghAuthListReposForAccount, accountId),
  ghAuthRebindRepos: (fromAccountId: number, toAccountId: number | null) =>
    invoke(Channels.ghAuthRebindRepos, fromAccountId, toAccountId),
  ghAuthSetRepoAccount: (repoId: number, accountId: number | null) =>
    invoke(Channels.ghAuthSetRepoAccount, repoId, accountId),
  ghOauthConfig: () => invoke(Channels.ghOauthConfig),
  ghOauthStart: () => invoke(Channels.ghOauthStart),
  ghOauthPoll: () => invoke(Channels.ghOauthPoll),
  ghOauthCancel: () => invoke(Channels.ghOauthCancel),
  ghListAllRepos: () => invoke(Channels.ghListAllRepos),
  ghListMyOrgs: (accountId: number) => invoke(Channels.ghListMyOrgs, accountId),
  ghListOrgRepos: (accountId: number, org: string) =>
    invoke(Channels.ghListOrgRepos, accountId, org),
  ghPrList: (repoId: number, state?: GithubPullRequestStateFilter) => invoke(Channels.ghPrList, repoId, state),
  ghPrDetail: (repoId: number, prNumber: number) => invoke(Channels.ghPrDetail, repoId, prNumber),
  ghPrCheckout: (repoId: number, prNumber: number) => invoke(Channels.ghPrCheckout, repoId, prNumber),
  ghPrSubmitReview: (repoId: number, input: GithubSubmitReviewInput) => invoke(Channels.ghPrSubmitReview, repoId, input),
  ghPrOpenInBrowser: (repoId: number, prNumber: number) => invoke(Channels.ghPrOpenInBrowser, repoId, prNumber),
  ghPrChecks: (repoId: number, ref: string) => invoke(Channels.ghPrChecks, repoId, ref),
  ghIssueList: (repoId: number, state?: GithubIssueStateFilter) => invoke(Channels.ghIssueList, repoId, state),
  ghIssueDetail: (repoId: number, issueNumber: number) => invoke(Channels.ghIssueDetail, repoId, issueNumber),
  ghIssueOpenInBrowser: (repoId: number, issueNumber: number) =>
    invoke(Channels.ghIssueOpenInBrowser, repoId, issueNumber),

  // System
  copyToClipboard: (text: string) => invoke(Channels.clipboardWrite, text),
  openExternal: (url: string) => invoke(Channels.shellOpenExternal, url),
};

contextBridge.exposeInMainWorld('differ', api);
