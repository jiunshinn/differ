import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import type {
  GithubAuthState,
  GithubPullRequestState,
  GithubPullRequestStateFilter,
  GithubPullRequestSummary,
} from '@shared/types';
import { cn } from '../utils/cn';

const FILTERS: { id: GithubPullRequestStateFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'merged', label: 'Merged' },
  { id: 'all', label: 'All' },
];

export default function PullRequestsView() {
  const { state, dispatch, toast } = useApp();
  const [prs, setPrs] = useState<GithubPullRequestSummary[]>([]);
  const [auth, setAuth] = useState<GithubAuthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const [filter, setFilter] = useState<GithubPullRequestStateFilter>('open');

  const repo = state.repo;

  const load = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      const a = await api.ghAuthStatus();
      setAuth(a);
      if (a.authenticated && repo.github_owner && repo.github_repo) {
        const list = await api.ghPrList(repo.id, filter);
        setPrs(list);
      } else {
        setPrs([]);
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, repo, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!repo) return null;

  const openPr = async (pr: GithubPullRequestSummary) => {
    if (opening != null) return;
    setOpening(pr.number);
    try {
      const session = await api.ghPrCheckout(repo.id, pr.number);
      dispatch({ type: 'setSession', session });
      dispatch({ type: 'setPrNumber', n: pr.number });
      dispatch({ type: 'view', view: 'pr-detail' });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="h-full w-full min-h-0 bg-bg-panel">
      <section className="h-full overflow-auto p-6 bg-bg">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Pull requests</h1>
            <p className="text-sm text-text-muted mt-1">
              {repo.github_owner && repo.github_repo
                ? `${repo.github_owner}/${repo.github_repo}`
                : 'No GitHub remote detected'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex bg-bg-panel border border-border rounded-lg p-[3px] gap-1">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    'h-7 px-2.5 rounded-md text-xs font-medium',
                    filter === item.id
                      ? 'bg-bg-subtle text-text-primary border border-border'
                      : 'text-text-muted hover:text-text-primary',
                  )}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </header>

        {!repo.github_owner || !repo.github_repo ? (
          <div className="panel-card p-6 text-sm text-text-secondary">
            <p>This repository has no GitHub remote we recognized.</p>
            <p className="text-text-muted text-xs mt-2 font-mono">
              (Looked for an origin URL like git@github.com:owner/repo or https://github.com/owner/repo.)
            </p>
          </div>
        ) : auth && !auth.authenticated ? (
          <div className="panel-card p-6 text-sm text-text-secondary">
            Sign in to GitHub from the toolbar (top right) to view pull requests.
          </div>
        ) : (
          <div className="panel-card overflow-hidden">
            {loading && <div className="px-4 py-3 text-text-muted text-sm">Loading…</div>}
            {!loading && prs.length === 0 && (
              <div className="px-4 py-3 text-text-muted text-sm">
                No {filter === 'all' ? '' : `${filter} `}pull requests.
              </div>
            )}
            <ul>
              {prs.map((pr) => {
                const isOpening = opening === pr.number;
                const isDisabled = opening != null && !isOpening;
                return (
                  <li
                    key={pr.number}
                    className={cn(
                      'px-4 py-3 border-b last:border-b-0 border-border',
                      isDisabled
                        ? 'opacity-50 pointer-events-none'
                        : 'hover:bg-bg-subtle cursor-pointer',
                      isOpening && 'bg-bg-subtle',
                    )}
                    onClick={() => void openPr(pr)}
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn('chip', pr.isDraft && 'text-text-muted')}>
                        #{pr.number}
                      </span>
                      <PrStateChip state={pr.state} isDraft={pr.isDraft} />
                      <span className="text-sm font-medium truncate flex-1">{pr.title}</span>
                      <span className="small-mono">{pr.author}</span>
                      <span className="small-mono">
                        {pr.headRef} → {pr.baseRef}
                      </span>
                      {isOpening && (
                        <span className="flex items-center gap-1.5 text-text-muted small-mono">
                          <Loader2 size={13} className="animate-spin" />
                          Opening…
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function PrStateChip({ state, isDraft }: { state: GithubPullRequestState; isDraft: boolean }) {
  const label = isDraft && state === 'open' ? 'draft' : state;
  return (
    <span
      className={cn(
        'tag capitalize',
        state === 'open' && 'text-success',
        state === 'closed' && 'text-danger',
        state === 'merged' && 'text-accent',
      )}
    >
      {label}
    </span>
  );
}
