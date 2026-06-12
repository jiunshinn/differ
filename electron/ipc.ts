import type { IpcMain, Dialog, Shell, Clipboard, BrowserWindow } from 'electron';
import { IpcChannels } from '../shared/types';
import path from 'node:path';
import fs from 'node:fs';
import { deriveCloneFolderName } from '../shared/clone';
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
  runGit,
  syncWithRemote as gitSync,
  rebaseContinue as gitRebaseContinue,
  rebaseAbort as gitRebaseAbort,
  mergeAbort as gitMergeAbort,
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
  DiffHunk,
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
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await fn(...(args as T));
      } catch (err) {
        // Re-throw with a clean message so the renderer does not surface
        // Electron's "Error invoking remote method '<channel>': Error: ..." prefix.
        // ipcMain re-wraps thrown Errors, so we strip any such prefix the message
        // may already carry and keep the original, user-facing text.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(stripRemoteInvokePrefix(message));
      }
    });
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
    await checkout(repo.path, requireRef(branch, 'branch'));
    return true;
  });

  handle(IpcChannels.repoCreateBranch, async (repoId: number, branch: string, doCheckout: boolean) => {
    const repo = mustRepo(repoId);
    await createBranch(repo.path, requireRef(branch, 'branch'), doCheckout);
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

  handle(
    IpcChannels.repoStageHunk,
    async (
      repoId: number,
      filePath: string,
      hunkHeader: string,
      opts?: { ignoreWhitespace?: boolean; staged?: boolean },
    ) => {
      const repo = mustRepo(repoId);
      // Re-derive the diff with the SAME whitespace mode the renderer used to
      // produce hunkHeader; otherwise -w changes hunk boundaries and the header
      // never matches.
      const diffs = await getDiff(repo.path, { ...opts, filePath, includeUntracked: true });
      const file = diffs.find((f) => f.filePath === filePath);
      if (!file) throw new Error(`No unstaged changes for ${filePath}`);
      const hunk = findHunk(file.hunks, hunkHeader);
      if (!hunk) throw new Error(`Hunk not found in ${filePath}`);
      await stageHunk(repo.path, file, hunk);
      return true;
    },
  );

  handle(
    IpcChannels.repoUnstageHunk,
    async (
      repoId: number,
      filePath: string,
      hunkHeader: string,
      opts?: { ignoreWhitespace?: boolean; staged?: boolean },
    ) => {
      const repo = mustRepo(repoId);
      const diffs = await getDiff(repo.path, { ...opts, filePath, staged: true });
      const file = diffs.find((f) => f.filePath === filePath);
      if (!file) throw new Error(`No staged changes for ${filePath}`);
      const hunk = findHunk(file.hunks, hunkHeader);
      if (!hunk) throw new Error(`Hunk not found in ${filePath}`);
      await unstageHunk(repo.path, file, hunk);
      return true;
    },
  );

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
  handle(IpcChannels.commentCreate, async (input: Parameters<typeof createComment>[0]) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid comment payload');
    if (!Number.isInteger(input.review_session_id)) {
      throw new Error('Invalid comment payload: review_session_id');
    }
    if (typeof input.body !== 'string' || input.body.trim() === '') {
      throw new Error('Comment body is required');
    }
    if (
      input.target_kind !== 'file' &&
      input.target_kind !== 'line' &&
      input.target_kind !== 'hunk'
    ) {
      throw new Error('Invalid comment payload: target_kind');
    }
    return createComment(input);
  });
  handle(IpcChannels.commentUpdate, async (id: number, patch: Parameters<typeof updateComment>[1]) =>
    updateComment(id, patch),
  );
  handle(IpcChannels.commentDelete, async (id: number) => {
    deleteComment(id);
    return true;
  });

  // File review state

  handle(IpcChannels.fileStateList, async (sessionId: number) => listFileStates(sessionId));
  handle(IpcChannels.fileStateSet, async (sessionId: number, filePath: string, status: string) => {
    if (status !== 'unviewed' && status !== 'viewed' && status !== 'reviewed') {
      throw new Error(`Invalid file review state: ${status}`);
    }
    return setFileState(sessionId, filePath, status);
  });

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
    await runGit(['fetch', 'origin', `pull/${prNumber}/head`], { cwd: repoRow.path });
    // Resolve the SHA we actually fetched rather than trusting the API snapshot:
    // if the PR was force-pushed between the API call and the fetch, detail.headSha
    // may be unreachable, so persist the fetched head to keep the session valid.
    let headSha = detail.headSha;
    try {
      const resolved = await runGit(['rev-parse', 'FETCH_HEAD'], { cwd: repoRow.path });
      const sha = resolved.stdout.trim();
      if (sha) headSha = sha;
    } catch {
      // Fall back to the API snapshot if FETCH_HEAD can't be resolved.
    }
    await runGit(['fetch', 'origin', detail.baseRef], { cwd: repoRow.path });
    return ensurePrSession(repoId, prNumber, headSha, detail.baseSha, detail.headRef, detail.baseRef);
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
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http(s) links can be opened externally');
    }
    await shell.openExternal(parsed.toString());
    return true;
  });
}

async function openRepoAtPath(repoPath: string, accountId: number | null = null): Promise<unknown> {
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
    // Only thread the account binding when explicitly provided (e.g. from clone flow).
    // Plain folder-open keeps any existing binding intact.
    ...(accountId != null ? { github_account_id: accountId } : {}),
  });
}

function mustRepo(id: number): NonNullable<ReturnType<typeof getRepositoryById>> {
  if (!Number.isInteger(id)) throw new Error('Invalid repository id');
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

// Strip Electron's "Error invoking remote method '<channel>': Error: " prefix that
// ipcMain adds when re-serializing a thrown Error, so the renderer shows the
// original user-facing message. Applied defensively in the handle() wrapper.
function stripRemoteInvokePrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
}

// Validate a user-supplied git ref/branch name before it reaches the git layer.
// Rejects empty values and leading-dash strings (which git would parse as options).
function requireRef(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`A ${label} name is required`);
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('-')) {
    throw new Error(`Invalid ${label} name: ${trimmed}`);
  }
  return trimmed;
}

// Locate a hunk by its exact header, falling back to matching old/new start lines.
// With ignore-whitespace on, git can emit slightly different line counts in the
// header even when the hunk starts at the same place, so the exact string may miss.
function findHunk(hunks: DiffHunk[], header: string): DiffHunk | undefined {
  const exact = hunks.find((h) => h.header === header);
  if (exact) return exact;
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  if (!match) return undefined;
  const oldStart = parseInt(match[1], 10);
  const newStart = parseInt(match[2], 10);
  return hunks.find((h) => h.oldStart === oldStart && h.newStart === newStart);
}
