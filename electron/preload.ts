import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/types';

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  // Repo
  pickRepo: () => invoke(IpcChannels.repoPick),
  openRepo: (path: string) => invoke(IpcChannels.repoOpen, path),
  recentRepos: () => invoke(IpcChannels.repoRecent),
  removeRecent: (id: number) => invoke(IpcChannels.repoRemove, id),
  setRepoPinned: (id: number, pinned: boolean) => invoke(IpcChannels.repoSetPinned, id, pinned),
  reorderRepos: (orderedIds: number[]) => invoke(IpcChannels.repoReorder, orderedIds),
  status: (repoId: number) => invoke(IpcChannels.repoStatus, repoId),
  branches: (repoId: number) => invoke(IpcChannels.repoBranches, repoId),
  commits: (repoId: number, limit?: number) => invoke(IpcChannels.repoCommits, repoId, limit),
  fetch: (repoId: number) => invoke(IpcChannels.repoFetch, repoId),
  pull: (repoId: number) => invoke(IpcChannels.repoPull, repoId),
  push: (repoId: number, opts?: { setUpstream?: boolean }) => invoke(IpcChannels.repoPush, repoId, opts),
  checkout: (repoId: number, branch: string) => invoke(IpcChannels.repoCheckout, repoId, branch),
  createBranch: (repoId: number, branch: string, checkout: boolean) =>
    invoke(IpcChannels.repoCreateBranch, repoId, branch, checkout),
  stageFile: (repoId: number, filePath: string) => invoke(IpcChannels.repoStageFile, repoId, filePath),
  unstageFile: (repoId: number, filePath: string) => invoke(IpcChannels.repoUnstageFile, repoId, filePath),
  stageHunk: (repoId: number, filePath: string, hunkHeader: string) =>
    invoke(IpcChannels.repoStageHunk, repoId, filePath, hunkHeader),
  unstageHunk: (repoId: number, filePath: string, hunkHeader: string) =>
    invoke(IpcChannels.repoUnstageHunk, repoId, filePath, hunkHeader),
  discardFile: (repoId: number, filePath: string) => invoke(IpcChannels.repoDiscardFile, repoId, filePath),
  commit: (repoId: number, message: string) => invoke(IpcChannels.repoCommit, repoId, message),
  amend: (repoId: number, message: string | null) => invoke(IpcChannels.repoAmend, repoId, message),

  // Diff
  fileDiff: (
    repoId: number,
    filePath: string,
    opts: { staged?: boolean; ignoreWhitespace?: boolean; includeUntracked?: boolean; base?: string; head?: string },
  ) => invoke(IpcChannels.diffFile, repoId, filePath, opts),
  allDiff: (
    repoId: number,
    opts: { staged?: boolean; ignoreWhitespace?: boolean; base?: string; head?: string },
  ) => invoke(IpcChannels.diffAll, repoId, opts),

  // Sessions
  ensureLocalSession: (repoId: number) => invoke(IpcChannels.sessionEnsureLocal, repoId),
  ensurePrSession: (repoId: number, prNumber: number, headSha: string, baseSha: string, branch: string, baseBranch: string) =>
    invoke(IpcChannels.sessionEnsurePr, repoId, prNumber, headSha, baseSha, branch, baseBranch),
  getSession: (sessionId: number) => invoke(IpcChannels.sessionGet, sessionId),

  // Comments
  listComments: (sessionId: number) => invoke(IpcChannels.commentList, sessionId),
  createComment: (input: unknown) => invoke(IpcChannels.commentCreate, input),
  updateComment: (id: number, patch: unknown) => invoke(IpcChannels.commentUpdate, id, patch),
  deleteComment: (id: number) => invoke(IpcChannels.commentDelete, id),

  // File review state
  getFileStates: (sessionId: number) => invoke(IpcChannels.fileStateList, sessionId),
  setFileState: (sessionId: number, filePath: string, status: string) =>
    invoke(IpcChannels.fileStateSet, sessionId, filePath, status),

  // Context
  previewContext: (input: unknown) => invoke(IpcChannels.contextPreview, input),
  saveContext: (input: unknown) => invoke(IpcChannels.contextSave, input),
  copyContext: (markdown: string) => invoke(IpcChannels.contextCopy, markdown),

  // GitHub
  ghAuthStatus: () => invoke(IpcChannels.ghAuthStatus),
  ghAuthSetToken: (token: string) => invoke(IpcChannels.ghAuthSetToken, token),
  ghAuthClear: () => invoke(IpcChannels.ghAuthClear),
  ghPrList: (repoId: number) => invoke(IpcChannels.ghPrList, repoId),
  ghPrDetail: (repoId: number, prNumber: number) => invoke(IpcChannels.ghPrDetail, repoId, prNumber),
  ghPrCheckout: (repoId: number, prNumber: number) => invoke(IpcChannels.ghPrCheckout, repoId, prNumber),
  ghPrSubmitReview: (repoId: number, input: unknown) => invoke(IpcChannels.ghPrSubmitReview, repoId, input),
  ghPrOpenInBrowser: (repoId: number, prNumber: number) => invoke(IpcChannels.ghPrOpenInBrowser, repoId, prNumber),
  ghPrChecks: (repoId: number, ref: string) => invoke(IpcChannels.ghPrChecks, repoId, ref),

  // System
  copyToClipboard: (text: string) => invoke(IpcChannels.clipboardWrite, text),
  openExternal: (url: string) => invoke(IpcChannels.shellOpenExternal, url),
};

contextBridge.exposeInMainWorld('differ', api);

export type DifferApi = typeof api;
