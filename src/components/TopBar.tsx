import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Monitor, Moon, RefreshCw, Sun } from 'lucide-react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import BranchMenu from './BranchMenu';
import GithubAuthDialog from './GithubAuthDialog';
import { cn } from '../utils/cn';
import { useTheme, type ThemeMode } from '../utils/theme';
import { useGithubAuthQuery, useRepoCommandMutation } from '../query/hooks';
import type { GithubAccount } from '@shared/types';

export default function TopBar() {
  const { state, dispatch, refresh, logActivity, toast, silentFetch } = useApp();
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const authQuery = useGithubAuthQuery();
  const accounts = authQuery.data?.accounts ?? [];
  const repo = state.repo;
  const status = state.status;
  const fetchMutation = useRepoCommandMutation(repo?.id ?? null, (repoId) => api.fetch(repoId));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const closeAuthDialog = () => {
    setAuthOpen(false);
    void authQuery.refetch();
  };

  const goView = (view: typeof state.view) => dispatch({ type: 'view', view });

  const run = async (label: string, kind: 'fetch' | 'pull' | 'push', fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
      toast('success', `${label} done`);
      logActivity({ kind, message: `${label} ${repo?.name ?? ''}`.trim() });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const titleText = repo
    ? state.view === 'pr-detail' && state.prNumber
      ? `Differ · ${repo.name} · PR #${state.prNumber}`
      : state.view === 'issues'
        ? `Differ · ${repo.name} · Issues`
        : `Differ · ${repo.name}`
    : 'Differ';

  useEffect(() => {
    document.title = titleText;
  }, [titleText]);

  const inSync = !!(repo && status && status.ahead === 0 && status.behind === 0);
  const hasSync = !!(repo && status);

  return (
    <>
      <div
        className="h-12 grid grid-cols-[1fr_auto] items-center gap-4 px-3.5 border-b border-border bg-bg-panel"
      >
        <div className="flex items-center gap-2 min-w-0 text-text-muted overflow-hidden">
          {repo ? (
            <>
              <span className="chip" title={repo.path}>
                {repo.name}
              </span>
              <BranchMenu />
              {status?.upstream && (
                <>
                  <span className="text-xs">into</span>
                  <span className="chip">{status.upstream}</span>
                </>
              )}
              {state.session && (
                <>
                  <span className="text-xs">·</span>
                  <span className="text-xs">
                    {state.files.length} {state.files.length === 1 ? 'file changed' : 'files changed'}
                  </span>
                </>
              )}
              {state.comments.filter((c) => c.status === 'open').length > 0 && (
                <>
                  <span className="text-xs">·</span>
                  <span className="text-xs">
                    {state.comments.filter((c) => c.status === 'open').length} open comments
                  </span>
                </>
              )}
              {hasSync && (
                <>
                  <span className="text-xs">·</span>
                  <button
                    type="button"
                    onClick={() => void silentFetch()}
                    className={cn(
                      'text-xs tabular-nums inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-bg-subtle transition-colors',
                      status!.behind > 0 && 'text-warn',
                    )}
                    title={
                      status!.behind > 0
                        ? `origin has ${status!.behind} commit${status!.behind === 1 ? '' : 's'} you don't have. Click to fetch.`
                        : 'Click to fetch from origin'
                    }
                  >
                    {inSync ? (
                      <span>in sync</span>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-0.5">
                          <ArrowUp size={11} strokeWidth={2.25} />
                          {status!.ahead}
                        </span>
                        <span className={cn('inline-flex items-center gap-0.5', status!.behind > 0 && 'font-semibold')}>
                          <ArrowDown size={11} strokeWidth={2.25} />
                          {status!.behind}
                        </span>
                      </>
                    )}
                  </button>
                  {state.lastFetchedAt && (
                    <span
                      className="text-[10px] text-text-muted"
                      title={new Date(state.lastFetchedAt).toLocaleString()}
                    >
                      {formatAgo(now - state.lastFetchedAt)}
                    </span>
                  )}
                </>
              )}
            </>
          ) : (
            <span className="text-xs text-text-muted">Local-first AI-native Git review</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {repo && (
            <>
              <ViewSwitch view={state.view} onChange={goView} />
              <div className="w-px h-5 bg-border mx-1" />
              <button
                className="btn"
                disabled={!!busy}
                onClick={() => run('Refresh', 'fetch', refresh)}
                title="Refresh status"
                aria-label="Refresh status"
              >
                <RefreshCw
                  size={14}
                  strokeWidth={2}
                  className={cn(busy === 'Refresh' && 'animate-spin')}
                />
              </button>
              <button
                className="btn"
                disabled={!!busy}
                onClick={() =>
                  run('Fetch', 'fetch', async () => {
                    await fetchMutation.mutateAsync();
                    dispatch({ type: 'setLastFetchedAt', at: Date.now() });
                    await refresh();
                  })
                }
              >
                Fetch
              </button>
              <SyncButton
                busy={busy}
                run={run}
                refresh={refresh}
                repoId={repo.id}
                status={status}
                dispatch={dispatch}
              />
              <AccountChip accounts={accounts} onClick={() => setAuthOpen(true)} />
            </>
          )}
          {!repo && <AccountChip accounts={accounts} onClick={() => setAuthOpen(true)} />}
          <ThemeToggle />
        </div>
      </div>

      {authOpen && <GithubAuthDialog onClose={closeAuthDialog} />}
    </>
  );
}

function AccountChip({
  accounts,
  onClick,
}: {
  accounts: GithubAccount[];
  onClick: () => void;
}) {
  if (accounts.length === 0) {
    return (
      <button className="btn" onClick={onClick} title="Sign in to GitHub">
        Sign in
      </button>
    );
  }
  const visible = accounts.slice(0, 3);
  const overflow = accounts.length - visible.length;
  const title =
    accounts.length === 1
      ? `Signed in as @${accounts[0].login}`
      : `${accounts.length} accounts: ${accounts.map((a) => '@' + a.login).join(', ')}`;
  return (
    <button
      className="btn w-auto px-2"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <span className="flex -space-x-1.5">
        {visible.map((a) =>
          a.avatarUrl ? (
            <img
              key={a.id}
              src={a.avatarUrl}
              alt={a.login}
              className="h-6 w-6 rounded-full border border-border-subtle bg-bg-panel"
            />
          ) : (
            <span
              key={a.id}
              className="h-6 w-6 rounded-full border border-border-subtle bg-bg-subtle text-[10px] flex items-center justify-center font-mono"
            >
              {a.login.slice(0, 2)}
            </span>
          ),
        )}
        {overflow > 0 && (
          <span className="h-6 w-6 rounded-full border border-border-subtle bg-bg-subtle text-[10px] flex items-center justify-center">
            +{overflow}
          </span>
        )}
      </span>
    </button>
  );
}

type RunFn = (label: string, kind: 'fetch' | 'pull' | 'push', fn: () => Promise<void>) => Promise<void>;

interface SyncButtonProps {
  busy: string | null;
  run: RunFn;
  refresh: () => Promise<void>;
  repoId: number;
  status: import('@shared/types').RepoStatus | null;
  dispatch: ReturnType<typeof useApp>['dispatch'];
}

function isConflictError(message: string): boolean {
  return /CONFLICT|conflict|merge conflict|unmerged/i.test(message);
}

type SyncMode = 'detached' | 'publish' | 'sync' | 'push' | 'pull' | 'up-to-date';

function deriveSyncMode(status: import('@shared/types').RepoStatus | null): SyncMode {
  if (!status) return 'up-to-date';
  if (status.detached) return 'detached';
  if (!status.upstream) return 'publish';
  if (status.ahead > 0 && status.behind > 0) return 'sync';
  if (status.behind > 0) return 'pull';
  if (status.ahead > 0) return 'push';
  return 'up-to-date';
}

function friendlyGitError(message: string): string {
  if (/non-fast-forward/i.test(message))
    return 'Remote has new commits. Click Sync to integrate before pushing.';
  if (/Please commit your changes or stash them/i.test(message) || /would be overwritten/i.test(message))
    return 'You have uncommitted changes. Commit or stash them, then try again.';
  if (/CONFLICT|conflict|merge conflict/i.test(message))
    return 'Rebase paused with conflicts. Resolve them in Local Changes, then continue.';
  if (/no upstream/i.test(message))
    return 'This branch has no upstream. Use Publish to create one.';
  if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(message))
    return 'Authentication failed. Check your credentials or sign in to GitHub.';
  // Trim long stderr dumps to the first line.
  return message.split('\n')[0]?.slice(0, 240) ?? message;
}

function SyncButton({ busy, run, refresh, repoId, status, dispatch }: SyncButtonProps) {
  const mode = deriveSyncMode(status);
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  const labels: Record<SyncMode, string> = {
    detached: 'Detached',
    'up-to-date': 'Up to date',
    publish: `Publish ↑${ahead}`,
    push: `Push ↑${ahead}`,
    pull: `Pull ↓${behind}`,
    sync: `Sync ↑${ahead} ↓${behind}`,
  };
  const titles: Record<SyncMode, string> = {
    detached: 'HEAD is detached — checkout a branch first',
    'up-to-date': 'Nothing to push or pull',
    publish: 'Push and set upstream to origin',
    push: `Push ${ahead} local commit${ahead === 1 ? '' : 's'} to origin`,
    pull: `Pull ${behind} remote commit${behind === 1 ? '' : 's'} (fast-forward)`,
    sync: `Rebase ${ahead} local commit${ahead === 1 ? '' : 's'} on top of ${behind} remote commit${behind === 1 ? '' : 's'}, then push`,
  };

  const disabled = !!busy || mode === 'detached' || mode === 'up-to-date';
  const isPrimary = mode === 'sync' || mode === 'push' || mode === 'publish';

  const handleError = async (raw: string): Promise<never> => {
    if (isConflictError(raw)) {
      // Pull/Sync paused mid-rebase or mid-merge — refresh status (so conflicted files surface),
      // jump the user to the Resolve view, and report a guided message.
      await refresh();
      dispatch({ type: 'view', view: 'history' });
      dispatch({ type: 'setHistoryTab', tab: 'resolve' });
      throw new Error('Conflicts detected. Resolve them in the Resolve view, then continue or abort.');
    }
    throw new Error(friendlyGitError(raw));
  };

  const onClick = (): void => {
    if (mode === 'sync') {
      void run('Sync', 'push', async () => {
        try {
          await api.sync(repoId);
        } catch (e) {
          await handleError((e as Error).message);
        }
        await refresh();
      });
      return;
    }
    if (mode === 'publish') {
      void run('Publish', 'push', async () => {
        try {
          await api.push(repoId, { setUpstream: true });
        } catch (e) {
          await handleError((e as Error).message);
        }
        await refresh();
      });
      return;
    }
    if (mode === 'push') {
      void run('Push', 'push', async () => {
        try {
          await api.push(repoId);
        } catch (e) {
          const msg = (e as Error).message;
          if (/no upstream/i.test(msg)) {
            await api.push(repoId, { setUpstream: true });
          } else {
            await handleError(msg);
          }
        }
        await refresh();
      });
      return;
    }
    if (mode === 'pull') {
      void run('Pull', 'pull', async () => {
        try {
          await api.pull(repoId);
        } catch (e) {
          await handleError((e as Error).message);
        }
        await refresh();
      });
      return;
    }
  };

  return (
    <button
      className={isPrimary ? 'btn-primary' : 'btn'}
      disabled={disabled}
      title={titles[mode]}
      onClick={onClick}
    >
      {labels[mode]}
    </button>
  );
}

function formatAgo(ms: number): string {
  const sec = Math.max(1, Math.floor(ms / 1000));
  if (sec < 60) return `fetched ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `fetched ${min}m ago`;
  const hr = Math.floor(min / 60);
  return `fetched ${hr}h ago`;
}

function ThemeToggle() {
  const { mode, isDark, setMode } = useTheme();
  const order: ThemeMode[] = ['system', 'light', 'dark'];
  const next = () => setMode(order[(order.indexOf(mode) + 1) % order.length]);
  const Icon = mode === 'system' ? Monitor : isDark ? Moon : Sun;
  const label = mode === 'system' ? 'Theme: System' : mode === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  return (
    <button
      className="btn-icon"
      onClick={next}
      title={`${label} (click to cycle)`}
      aria-label={label}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  );
}

function ViewSwitch({
  view,
  onChange,
}: {
  view: 'picker' | 'local' | 'pr-list' | 'pr-detail' | 'issues' | 'history' | 'code';
  onChange: (v: 'local' | 'pr-list' | 'issues' | 'history' | 'code') => void;
}) {
  const tabs = [
    { id: 'local' as const, label: 'Local' },
    { id: 'code' as const, label: 'Code' },
    { id: 'history' as const, label: 'History' },
    { id: 'pr-list' as const, label: 'Pull requests' },
    { id: 'issues' as const, label: 'Issues' },
  ];
  return (
    <div className="inline-flex bg-bg border border-border rounded-lg p-[3px] gap-1">
      {tabs.map((t) => {
        const active =
          view === t.id ||
          (t.id === 'pr-list' && view === 'pr-detail');
        return (
          <button
            key={t.id}
            className={cn(
              'min-h-[28px] px-2.5 rounded-md text-xs font-medium tracking-wide',
              active
                ? 'bg-bg-panel text-text-primary border border-border'
                : 'text-text-muted hover:text-text-primary',
            )}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
