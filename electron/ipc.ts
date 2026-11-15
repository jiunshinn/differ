import type { IpcMain, Dialog, Shell, Clipboard, BrowserWindow } from 'electron';
import { IpcChannels } from '../shared/types';
import path from 'node:path';
import fs from 'node:fs';
import {
  amend,
  checkout,
  clone as gitClone,
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
  syncWithRemote as gitSync,
  rebaseContinue as gitRebaseContinue,
  rebaseAbort as gitRebaseAbort,
  mergeAbort as gitMergeAbort,
  stageFile,
  stageHunk,
  unstageFile,
  unstageHunk,
  withSshTarget,
} from './services/git';
import { getEnvironment } from './environments';
import { listDirectory } from './services/fsBrowse';
import { sshTarget } from './services/ssh';
import {
  basenameOfPath,
  getRepositoryById,
  getRepositoryByPath,
  listRecentRepositories,
  removeRepository,
  reorderRepositories,
  setRepositoryPinned,
  upsertRepository,
} from './services/repoStore';
import { listTree, readFile as readRepoFile } from './services/fileTree';
import { ensureLocalSession, ensurePrSession, getSession } from './services/sessionStore';
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from './services/commentStore';
import { listFileStates, setFileState } from './services/fileReviewStore';
import {
  addAccount,
  getIssueDetail,
  getPullRequestDetail,
  getTokenForAccount,
  listAccounts,
  listAllRepos,
  listCheckRuns,
  listIssues,
  listMyOrgs,
  listOrgRepos,
  listPullRequests,
  listReposBoundToAccount,
  rebindRepos,
  removeAccount,
  setAccountForRepo,
  submitReview,
} from './services/githubService';
import {
  cancelDeviceFlow,
  getOAuthConfig,
  pollDeviceFlow,
  startDeviceFlow,
} from './services/githubOAuth';
import type {
  CloneRequest,
  GithubIssueStateFilter,
  GithubPullRequestStateFilter,
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

  // Open a folder that lives on a specific machine (this Mac or an ssh environment).
  handle(IpcChannels.repoOpenInEnvironment, async (environmentId: string, repoPath: string) =>
    openRepoAtPath(repoPath, null, environmentId),
  );

  // Folder navigation for the "Add project" dialog.
  handle(IpcChannels.fsListDir, async (environmentId: string | null, dirPath: string | null) =>
    listDirectory(environmentId, dirPath),
  );

  handle(IpcChannels.repoPickDirectory, async (title?: string) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: title ?? 'Choose a folder',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  handle(IpcChannels.repoClone, async (req: CloneRequest) => {
    if (!req || !req.remoteUrl || !req.parentDir) {
      throw new Error('Remote URL and parent directory are required');
    }
    if (!fs.existsSync(req.parentDir)) {
      throw new Error(`Parent directory does not exist: ${req.parentDir}`);
    }
    const folder = (req.folderName && req.folderName.trim()) || deriveCloneFolderName(req.remoteUrl);
    if (!folder) throw new Error('Could not derive a target folder name from the URL');
    const dest = path.join(req.parentDir, folder);
    const authToken =
      req.useAuthToken && req.accountId != null ? getTokenForAccount(req.accountId) : null;
    const cloned = await gitClone(req.remoteUrl, dest, { authToken });
    return openRepoAtPath(cloned, req.accountId ?? null);
  });

  handle(IpcChannels.repoRecent, async () => listRecentRepositories());
  handle(IpcChannels.repoRemove, async (id: number) => {
    removeRepository(id);
    return true;
  });
  handle(IpcChannels.repoSetPinned, async (id: number, pinned: boolean) =>
    setRepositoryPinned(id, pinned),
  );
  handle(IpcChannels.repoReorder, async (orderedIds: number[]) => {
    reorderRepositories(orderedIds);
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

  handle(IpcChannels.repoPull, async (repoId: number, opts?: { rebase?: boolean }) => {
    const repo = mustRepo(repoId);
    await gitPull(repo.path, opts ?? {});
    return true;
  });

  handle(IpcChannels.repoSync, async (repoId: number) => {
    const repo = mustRepo(repoId);
    await gitSync(repo.path);
    return true;
  });

  handle(IpcChannels.repoRebaseContinue, async (repoId: number) => {
    const repo = mustRepo(repoId);
    await gitRebaseContinue(repo.path);
    return true;
  });

  handle(IpcChannels.repoRebaseAbort, async (repoId: number) => {
    const repo = mustRepo(repoId);
    await gitRebaseAbort(repo.path);
    return true;
  });

  handle(IpcChannels.repoMergeAbort, async (repoId: number) => {
    const repo = mustRepo(repoId);
    await gitMergeAbort(repo.path);
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

  handle(IpcChannels.repoListTree, async (repoId: number, relDir?: string) => {
    const repo = mustRepo(repoId);
    return listTree(repo.path, relDir ?? '');
  });

  handle(IpcChannels.repoReadFile, async (repoId: number, relPath: string) => {
    const repo = mustRepo(repoId);
    return readRepoFile(repo.path, relPath);
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

  // GitHub

  handle(IpcChannels.ghAuthList, async () => ({ accounts: await listAccounts() }));
  handle(IpcChannels.ghAuthAddToken, async (token: string) => addAccount(token));
  handle(IpcChannels.ghAuthRemove, async (accountId: number) => {
    await removeAccount(accountId);
    return { accounts: await listAccounts() };
  });
  handle(IpcChannels.ghAuthListReposForAccount, async (accountId: number) => {
    const ids = listReposBoundToAccount(accountId);
    return ids
      .map((id) => getRepositoryById(id))
      .filter((r): r is NonNullable<ReturnType<typeof getRepositoryById>> => r != null);
  });
  handle(
    IpcChannels.ghAuthRebindRepos,
    async (fromAccountId: number, toAccountId: number | null) => rebindRepos(fromAccountId, toAccountId),
  );
  handle(
    IpcChannels.ghAuthSetRepoAccount,
    async (repoId: number, accountId: number | null) => {
      mustRepo(repoId);
      setAccountForRepo(repoId, accountId);
      return getRepositoryById(repoId);
    },
  );

  handle(IpcChannels.ghOauthConfig, async () => getOAuthConfig());
  handle(IpcChannels.ghOauthStart, async () => startDeviceFlow());
  handle(IpcChannels.ghOauthPoll, async () => pollDeviceFlow());
  handle(IpcChannels.ghOauthCancel, async () => {
    cancelDeviceFlow();
    return true;
  });

  handle(IpcChannels.ghListAllRepos, async () => listAllRepos());
  handle(IpcChannels.ghListMyOrgs, async (accountId: number) => listMyOrgs(accountId));
  handle(IpcChannels.ghListOrgRepos, async (accountId: number, org: string) =>
    listOrgRepos(accountId, org),
  );

  handle(IpcChannels.ghPrList, async (repoId: number, state?: GithubPullRequestStateFilter) => {
    const { accountId, owner, repo } = mustGithubRepo(repoId);
    return listPullRequests(accountId, owner, repo, state ?? 'open');
  });

  handle(IpcChannels.ghPrDetail, async (repoId: number, prNumber: number) => {
    const { accountId, owner, repo } = mustGithubRepo(repoId);
    return getPullRequestDetail(accountId, owner, repo, prNumber);
  });

  handle(IpcChannels.ghPrCheckout, async (repoId: number, prNumber: number) => {
    const repoRow = mustRepo(repoId);
    const { accountId, owner, repo } = mustGithubRepo(repoId);
    const detail = await getPullRequestDetail(accountId, owner, repo, prNumber);
    // Make the PR head and base reachable locally so the diff view (origin/<base>..<headSha>)
    // resolves. Do not touch the working tree — viewing a PR should not switch branches.
    const { runGit } = await import('./services/git');
    await runGit(['fetch', 'origin', `pull/${prNumber}/head`], { cwd: repoRow.path });
    await runGit(['fetch', 'origin', detail.baseRef], { cwd: repoRow.path });
    return ensurePrSession(repoId, prNumber, detail.headSha, detail.baseSha, detail.headRef, detail.baseRef);
  });

  handle(IpcChannels.ghPrSubmitReview, async (repoId: number, input: GithubSubmitReviewInput) => {
    const { accountId, owner, repo } = mustGithubRepo(repoId);
    await submitReview(accountId, owner, repo, input);
    return true;
  });

  handle(IpcChannels.ghPrOpenInBrowser, async (repoId: number, prNumber: number) => {
    const { owner, repo } = mustGithubRepo(repoId);
    await shell.openExternal(`https://github.com/${owner}/${repo}/pull/${prNumber}`);
    return true;
  });

  handle(IpcChannels.ghPrChecks, async (repoId: number, ref: string) => {
    const { accountId, owner, repo } = mustGithubRepo(repoId);
    return listCheckRuns(accountId, owner, repo, ref);
  });

  handle(IpcChannels.ghIssueList, async (repoId: number, state?: GithubIssueStateFilter) => {
    const { accountId, owner, repo } = mustGithubRepo(repoId);
    return listIssues(accountId, owner, repo, state ?? 'open');
  });

  handle(IpcChannels.ghIssueDetail, async (repoId: number, issueNumber: number) => {
    const { accountId, owner, repo } = mustGithubRepo(repoId);
    return getIssueDetail(accountId, owner, repo, issueNumber);
  });

  handle(IpcChannels.ghIssueOpenInBrowser, async (repoId: number, issueNumber: number) => {
    const { owner, repo } = mustGithubRepo(repoId);
    await shell.openExternal(`https://github.com/${owner}/${repo}/issues/${issueNumber}`);
    return true;
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

async function openRepoAtPath(
  repoPath: string,
  accountId: number | null = null,
  environmentId?: string,
): Promise<unknown> {
  const trimmed = repoPath.trim();
  // Callers either name the machine (the add-project dialog) or just the path
  // (recents, native picker). In the latter case keep whatever the row has.
  const named = environmentId && environmentId !== 'local' ? environmentId : null;
  const effectiveEnvId = named ?? getRepositoryByPath(trimmed)?.environment_id ?? 'local';
  const env = effectiveEnvId === 'local' ? undefined : getEnvironment(effectiveEnvId);
  if (effectiveEnvId !== 'local' && !env) {
    throw new Error(`The environment this project lives on no longer exists (${effectiveEnvId})`);
  }
  if (env && !(trimmed.startsWith('/') || trimmed.startsWith('~'))) {
    throw new Error(`Enter an absolute path on ${env.name} (for example ~/src/app)`);
  }
  // Git for this folder has to run on the machine that owns it. Register the
  // target for the duration of the open; afterwards the repository row resolves it.
  return withSshTarget(trimmed, env ? sshTarget(env) : null, async () => {
    if (!(await isGitRepo(trimmed))) {
      throw new Error('Selected folder is not a Git repository');
    }
    const top = await getRepoTopLevel(trimmed);
    // The repositories table keys on path, so the same absolute path on two
    // machines can't be stored twice. Say so instead of silently re-binding.
    const clash = getRepositoryByPath(top);
    if (clash && clash.environment_id !== effectiveEnvId) {
      const otherEnv = clash.environment_id === 'local' ? 'this Mac' : getEnvironment(clash.environment_id)?.name ?? clash.environment_id;
      throw new Error(
        `“${basenameOfPath(top)}” is already added from ${otherEnv}. Remove it from the project list first.`,
      );
    }
    const remoteUrl = await getRemoteUrl(top);
    const defaultBranch = await getDefaultBranch(top);
    const gh = parseGithubFromRemote(remoteUrl);
    return upsertRepository(top, {
      name: basenameOfPath(top),
      default_branch: defaultBranch,
      remote_url: remoteUrl,
      github_owner: gh?.owner ?? null,
      github_repo: gh?.repo ?? null,
      environment_id: effectiveEnvId,
      // Only thread the account binding when explicitly provided (e.g. from clone flow).
      // Plain folder-open keeps any existing binding intact.
      ...(accountId != null ? { github_account_id: accountId } : {}),
    });
  });
}

function mustRepo(id: number): NonNullable<ReturnType<typeof getRepositoryById>> {
  const r = getRepositoryById(id);
  if (!r) throw new Error(`Repository ${id} not found`);
  return r;
}

function mustGithubRepo(id: number): { accountId: number; owner: string; repo: string } {
  const r = mustRepo(id);
  if (!r.github_owner || !r.github_repo) {
    throw new Error('Repository is not connected to GitHub');
  }
  if (r.github_account_id == null) {
    throw new Error(
      'This repository has no GitHub account bound. Open the account menu in the top bar and assign one.',
    );
  }
  return { accountId: r.github_account_id, owner: r.github_owner, repo: r.github_repo };
}

function deriveCloneFolderName(remoteUrl: string): string {
  // Strip trailing slashes and a single trailing .git
  const trimmed = remoteUrl.trim().replace(/\/+$/, '');
  const noGit = trimmed.replace(/\.git$/i, '');
  // Take the last path segment after / or :
  const parts = noGit.split(/[/:]/);
  return (parts[parts.length - 1] || '').trim();
}
