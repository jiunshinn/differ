import React, { useEffect, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import BranchMenu from './BranchMenu';
import GithubAuthDialog from './GithubAuthDialog';
import { cn } from '../utils/cn';
import { useTheme, type ThemeMode } from '../utils/theme';

export default function TopBar() {
  const { state, dispatch, refresh, logActivity, toast } = useApp();
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const repo = state.repo;
  const status = state.status;

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
      : `Differ · ${repo.name}`
    : 'Differ';

  useEffect(() => {
    document.title = titleText;
  }, [titleText]);

  const syncText =
    repo && status
      ? status.ahead === 0 && status.behind === 0
        ? 'in sync'
        : `↑${status.ahead} ↓${status.behind}`
      : null;

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
              {syncText && (
                <>
                  <span className="text-xs">·</span>
                  <span className="text-xs tabular-nums">{syncText}</span>
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
              >
                ↻
              </button>
              <button
                className="btn"
                disabled={!!busy}
                onClick={() =>
                  run('Fetch', 'fetch', async () => {
                    await api.fetch(repo.id);
                    await refresh();
                  })
                }
              >
                Fetch
              </button>
              <button
                className="btn"
                disabled={!!busy}
                onClick={() =>
                  run('Pull', 'pull', async () => {
                    await api.pull(repo.id);
                    await refresh();
                  })
                }
              >
                Pull
              </button>
              <button
                className="btn"
                disabled={!!busy}
                onClick={() =>
                  run('Push', 'push', async () => {
                    try {
                      await api.push(repo.id);
                    } catch (e) {
                      if ((e as Error).message.includes('no upstream')) {
                        await api.push(repo.id, { setUpstream: true });
                      } else {
                        throw e;
                      }
                    }
                    await refresh();
                  })
                }
              >
                Push
              </button>
              <button className="btn" onClick={() => setAuthOpen(true)}>
                GitHub
              </button>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>

      {authOpen && <GithubAuthDialog onClose={() => setAuthOpen(false)} />}
    </>
  );
}

function ThemeToggle() {
  const { mode, isDark, setMode } = useTheme();
  const order: ThemeMode[] = ['system', 'light', 'dark'];
  const next = () => setMode(order[(order.indexOf(mode) + 1) % order.length]);
  const icon = mode === 'system' ? '◐' : isDark ? '☾' : '☀';
  const label = mode === 'system' ? 'Theme: System' : mode === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  return (
    <button
      className="btn-icon"
      onClick={next}
      title={`${label} (click to cycle)`}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

function ViewSwitch({
  view,
  onChange,
}: {
  view: 'picker' | 'local' | 'pr-list' | 'pr-detail' | 'context' | 'history' | 'code';
  onChange: (v: 'local' | 'pr-list' | 'context' | 'history' | 'code') => void;
}) {
  const tabs = [
    { id: 'local' as const, label: 'Local' },
    { id: 'code' as const, label: 'Code' },
    { id: 'history' as const, label: 'History' },
    { id: 'pr-list' as const, label: 'Pull requests' },
    { id: 'context' as const, label: 'Context' },
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
