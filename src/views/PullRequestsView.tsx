import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import type { GithubAuthState, GithubPullRequestSummary } from '@shared/types';
import { cn } from '../utils/cn';

export default function PullRequestsView() {
  const { state, dispatch, toast } = useApp();
  const [prs, setPrs] = useState<GithubPullRequestSummary[]>([]);
  const [auth, setAuth] = useState<GithubAuthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);

  const repo = state.repo;

  const load = async () => {
    if (!repo) return;
    setLoading(true);
    try {
      const a = await api.ghAuthStatus();
      setAuth(a);
      if (a.authenticated && repo.github_owner && repo.github_repo) {
        const list = await api.ghPrList(repo.id);
        setPrs(list);
      } else {
        setPrs([]);
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.id]);

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
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
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
              <div className="px-4 py-3 text-text-muted text-sm">No open pull requests.</div>
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
