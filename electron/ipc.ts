import type { IpcMain, Dialog, Shell, Clipboard, BrowserWindow } from 'electron';
import { IpcChannels } from '../shared/types';
import {
  amend,
  checkout,
  commit as gitCommit,
  createBranch,
  discardFile,
  fetch as gitFetch,
  getCommits,
  getDefaultBranch,
  getDiff,
  getRemoteUrl,
  getRepoTopLevel,
  getStatus,
  isGitRepo,
  listBranches,
  parseGithubFromRemote,
  pull as gitPull,
  push as gitPush,
  stageFile,
  stageHunk,
  unstageFile,
  unstageHunk,
} from './services/git';
import {
  basenameOfPath,
  getRepositoryById,
  listRecentRepositories,
  removeRepository,
  upsertRepository,
} from './services/repoStore';
import { ensureLocalSession, ensurePrSession, getSession } from './services/sessionStore';
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from './services/commentStore';
import { listFileStates, setFileState } from './services/fileReviewStore';
import { previewContext, saveContext } from './services/contextService';
import {
  clearAuth,
  getAuthStatus,
  getPullRequestDetail,
  listCheckRuns,
  listPullRequests,
  setToken,
  submitReview,
} from './services/githubService';
import type {
  ContextExtractionInput,
  GithubSubmitReviewInput,
} from '../shared/types';

interface Deps {
  ipcMain: IpcMain;
  dialog: Dialog;
  shell: Shell;
  clipboard: Clipboard;
  getWindow: () => BrowserWindow | null;
}

export function registerIpcHandlers(deps: Deps): void {
  const { ipcMain, dialog, shell, clipboard, getWindow } = deps;
  const handle = <T extends unknown[], R>(channel: string, fn: (...args: T) => Promise<R> | R): void => {
    ipcMain.handle(channel, async (_e, ...args) => fn(...(args as T)));
  };

  handle(IpcChannels.repoPick, async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Open a Git repository',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return openRepoAtPath(result.filePaths[0]);
  });

  handle(IpcChannels.repoOpen, async (repoPath: string) => openRepoAtPath(repoPath));

  handle(IpcChannels.repoRecent, async () => listRecentRepositories());
  handle(IpcChannels.repoRemove, async (id: number) => {
    removeRepository(id);
    return true;
  });

  handle(IpcChannels.repoStatus, async (repoId: number) => {
    const repo = mustRepo(repoId);
    return getStatus(repo.path);
  });

  handle(IpcChannels.repoBranches, async (repoId: number) => {
    const repo = mustRepo(repoId);
    return listBranches(repo.path);
  });

  handle(IpcChannels.repoCommits, async (repoId: number, limit?: number) => {
    const repo = mustRepo(repoId);
    return getCommits(repo.path, limit ?? 30);
  });

  handle(IpcChannels.repoFetch, async (repoId: number) => {
    const repo = mustRepo(repoId);
    await gitFetch(repo.path);
    return true;
  });

  handle(IpcChannels.repoPull, async (repoId: number) => {
    const repo = mustRepo(repoId);
    await gitPull(repo.path);
    return true;
  });

  handle(IpcChannels.repoPush, async (repoId: number, opts?: { setUpstream?: boolean }) => {
    const repo = mustRepo(repoId);
    await gitPush(repo.path, opts ?? {});
    return true;
  });

  handle(IpcChannels.repoCheckout, async (repoId: number, branch: string) => {
    const repo = mustRepo(repoId);
    await checkout(repo.path, branch);
    return true;
  });

  handle(IpcChannels.repoCreateBranch, async (repoId: number, branch: string, doCheckout: boolean) => {
    const repo = mustRepo(repoId);
    await createBranch(repo.path, branch, doCheckout);
    return true;
  });

  handle(IpcChannels.repoStageFile, async (repoId: number, filePath: string) => {
    const repo = mustRepo(repoId);
    await stageFile(repo.path, filePath);
    return true;
  });

  handle(IpcChannels.repoUnstageFile, async (repoId: number, filePath: string) => {
    const repo = mustRepo(repoId);
    await unstageFile(repo.path, filePath);
    return true;
  });

  handle(IpcChannels.repoStageHunk, async (repoId: number, filePath: string, hunkHeader: string) => {
    const repo = mustRepo(repoId);
    const diffs = await getDiff(repo.path, { filePath, includeUntracked: true });
    const file = diffs.find((f) => f.filePath === filePath);
    if (!file) throw new Error(`No unstaged changes for ${filePath}`);
    const hunk = file.hunks.find((h) => h.header === hunkHeader);
    if (!hunk) throw new Error(`Hunk not found in ${filePath}`);
    await stageHunk(repo.path, file, hunk);
    return true;
  });

  handle(IpcChannels.repoUnstageHunk, async (repoId: number, filePath: string, hunkHeader: string) => {
    const repo = mustRepo(repoId);
    const diffs = await getDiff(repo.path, { filePath, staged: true });
    const file = diffs.find((f) => f.filePath === filePath);
    if (!file) throw new Error(`No staged changes for ${filePath}`);
    const hunk = file.hunks.find((h) => h.header === hunkHeader);
    if (!hunk) throw new Error(`Hunk not found in ${filePath}`);
    await unstageHunk(repo.path, file, hunk);
    return true;
  });

  handle(IpcChannels.repoDiscardFile, async (repoId: number, filePath: string) => {
    const repo = mustRepo(repoId);
    await discardFile(repo.path, filePath);
    return true;
  });

  handle(IpcChannels.repoCommit, async (repoId: number, message: string) => {
    const repo = mustRepo(repoId);
    await gitCommit(repo.path, message);
    return true;
  });

  handle(IpcChannels.repoAmend, async (repoId: number, message: string | null) => {
    const repo = mustRepo(repoId);
    await amend(repo.path, message);
    return true;
  });

  // Diff

  handle(
    IpcChannels.diffFile,
    async (
      repoId: number,
      filePath: string,
      opts: { staged?: boolean; ignoreWhitespace?: boolean; includeUntracked?: boolean; base?: string; head?: string },
    ) => {
      const repo = mustRepo(repoId);
      const diffs = await getDiff(repo.path, { ...opts, filePath });
      return diffs[0] ?? null;
    },
  );

  handle(
    IpcChannels.diffAll,
    async (
      repoId: number,
      opts: { staged?: boolean; ignoreWhitespace?: boolean; base?: string; head?: string },
    ) => {
      const repo = mustRepo(repoId);
      const includeUntracked = !opts.staged && !opts.base && !opts.head;
      return getDiff(repo.path, { ...opts, includeUntracked });
    },
  );

  // Sessions

  handle(IpcChannels.sessionEnsureLocal, async (repoId: number) => {
    const repo = mustRepo(repoId);
    const status = await getStatus(repo.path);
    return ensureLocalSession(repoId, status.branch);
  });

  handle(
    IpcChannels.sessionEnsurePr,
    async (
      repoId: number,
      prNumber: number,
      headSha: string,
      baseSha: string,
      branch: string,
      baseBranch: string,
    ) => ensurePrSession(repoId, prNumber, headSha, baseSha, branch, baseBranch),
  );

  handle(IpcChannels.sessionGet, async (id: number) => getSession(id));

  // Comments

  handle(IpcChannels.commentList, async (sessionId: number) => listComments(sessionId));
  handle(IpcChannels.commentCreate, async (input: Parameters<typeof createComment>[0]) =>
    createComment(input),
  );
  handle(IpcChannels.commentUpdate, async (id: number, patch: Parameters<typeof updateComment>[1]) =>
    updateComment(id, patch),
  );
  handle(IpcChannels.commentDelete, async (id: number) => {
    deleteComment(id);
    return true;
  });

  // File review state

  handle(IpcChannels.fileStateList, async (sessionId: number) => listFileStates(sessionId));
  handle(IpcChannels.fileStateSet, async (sessionId: number, filePath: string, status: string) =>
    setFileState(sessionId, filePath, status as Parameters<typeof setFileState>[2]),
  );

  // Context

  handle(IpcChannels.contextPreview, async (input: ContextExtractionInput) => previewContext(input));
  handle(
    IpcChannels.contextSave,
    async (input: { sessionId: number; title: string; task: string; output: string; included: Parameters<typeof saveContext>[4] }) =>
      saveContext(input.sessionId, input.title, input.task, input.output, input.included),
  );
  handle(IpcChannels.contextCopy, async (markdown: string) => {
    clipboard.writeText(markdown);
    return true;
  });

  // GitHub

  handle(IpcChannels.ghAuthStatus, async () => getAuthStatus());
  handle(IpcChannels.ghAuthSetToken, async (token: string) => setToken(token));
  handle(IpcChannels.ghAuthClear, async () => clearAuth());

  handle(IpcChannels.ghPrList, async (repoId: number) => {
    const repo = mustRepo(repoId);
    if (!repo.github_owner || !repo.github_repo) throw new Error('Repository is not connected to GitHub');
    return listPullRequests(repo.github_owner, repo.github_repo);
  });

  handle(IpcChannels.ghPrDetail, async (repoId: number, prNumber: number) => {
    const repo = mustRepo(repoId);
    if (!repo.github_owner || !repo.github_repo) throw new Error('Repository is not connected to GitHub');
    return getPullRequestDetail(repo.github_owner, repo.github_repo, prNumber);
  });

  handle(IpcChannels.ghPrCheckout, async (repoId: number, prNumber: number) => {
    const repo = mustRepo(repoId);
    if (!repo.github_owner || !repo.github_repo) throw new Error('Repository is not connected to GitHub');
    const detail = await getPullRequestDetail(repo.github_owner, repo.github_repo, prNumber);
    // Fetch the PR ref into a local branch.
    const localBranch = `pr/${prNumber}`;
    const { runGit } = await import('./services/git');
    await runGit(['fetch', 'origin', `pull/${prNumber}/head:${localBranch}`], { cwd: repo.path });
    await runGit(['checkout', localBranch], { cwd: repo.path });
    return ensurePrSession(repoId, prNumber, detail.headSha, detail.baseSha, detail.headRef, detail.baseRef);
  });

  handle(IpcChannels.ghPrSubmitReview, async (repoId: number, input: GithubSubmitReviewInput) => {
    const repo = mustRepo(repoId);
    if (!repo.github_owner || !repo.github_repo) throw new Error('Repository is not connected to GitHub');
    await submitReview(repo.github_owner, repo.github_repo, input);
    return true;
  });

  handle(IpcChannels.ghPrOpenInBrowser, async (repoId: number, prNumber: number) => {
    const repo = mustRepo(repoId);
    if (!repo.github_owner || !repo.github_repo) throw new Error('Repository is not connected to GitHub');
    await shell.openExternal(`https://github.com/${repo.github_owner}/${repo.github_repo}/pull/${prNumber}`);
    return true;
  });

  handle(IpcChannels.ghPrChecks, async (repoId: number, ref: string) => {
    const repo = mustRepo(repoId);
    if (!repo.github_owner || !repo.github_repo) throw new Error('Repository is not connected to GitHub');
    return listCheckRuns(repo.github_owner, repo.github_repo, ref);
  });

  // System

  handle(IpcChannels.clipboardWrite, async (text: string) => {
    clipboard.writeText(text);
    return true;
  });

  handle(IpcChannels.shellOpenExternal, async (url: string) => {
    await shell.openExternal(url);
    return true;
  });
}

async function openRepoAtPath(repoPath: string): Promise<unknown> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error('Selected folder is not a Git repository');
  }
  const top = await getRepoTopLevel(repoPath);
  const remoteUrl = await getRemoteUrl(top);
  const defaultBranch = await getDefaultBranch(top);
  const gh = parseGithubFromRemote(remoteUrl);
  return upsertRepository(top, {
    name: basenameOfPath(top),
    default_branch: defaultBranch,
    remote_url: remoteUrl,
    github_owner: gh?.owner ?? null,
    github_repo: gh?.repo ?? null,
  });
}

function mustRepo(id: number): NonNullable<ReturnType<typeof getRepositoryById>> {
  const r = getRepositoryById(id);
  if (!r) throw new Error(`Repository ${id} not found`);
  return r;
}
