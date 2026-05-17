import React, { useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import BranchMenu from './BranchMenu';
import GithubAuthDialog from './GithubAuthDialog';
import { cn } from '../utils/cn';

export default function TopBar() {
  const { state, dispatch, refresh, toast } = useApp();
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const repo = state.repo;
  const status = state.status;

  const goView = (view: typeof state.view) => dispatch({ type: 'view', view });

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
      toast('success', `${label} done`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-11 flex items-center gap-2 px-3 border-b border-border bg-bg-panel select-none drag-region"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="w-16" /> {/* macOS traffic-light spacing */}
        <button className="btn-ghost" onClick={() => goView('picker')}>
          <span className="font-semibold">Differ</span>
        </button>
        {repo && (
          <>
            <span className="text-text-muted">•</span>
            <span className="text-sm text-text-secondary">{repo.name}</span>
            <BranchMenu />
            {status && (
              <span className="tag">
                {status.ahead > 0 && <span className="text-emerald-300">↑{status.ahead}</span>}
                {status.behind > 0 && <span className="text-amber-300">↓{status.behind}</span>}
                {status.ahead === 0 && status.behind === 0 && (
                  <span className="text-text-muted">in sync</span>
                )}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex-1" />
      {repo && (
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            className={cn('btn-ghost', state.view === 'local' && 'bg-bg-hover')}
            onClick={() => goView('local')}
          >
            Local
          </button>
          <button
            className={cn('btn-ghost', state.view === 'pr-list' && 'bg-bg-hover')}
            onClick={() => goView('pr-list')}
          >
            Pull Requests
          </button>
          <button
            className={cn('btn-ghost', state.view === 'context' && 'bg-bg-hover')}
            onClick={() => goView('context')}
          >
            Context
          </button>
          <div className="mx-2 h-5 w-px bg-border" />
          <button className="btn" disabled={!!busy} onClick={() => run('Refresh', refresh)}>
            ↻
          </button>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => run('Fetch', async () => { await api.fetch(repo.id); await refresh(); })}
          >
            Fetch
          </button>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => run('Pull', async () => { await api.pull(repo.id); await refresh(); })}
          >
            Pull
          </button>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              run('Push', async () => {
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
          <button className="btn-ghost" onClick={() => setAuthOpen(true)}>
            GitHub…
          </button>
        </div>
      )}
      {authOpen && <GithubAuthDialog onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
