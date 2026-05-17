import React, { useEffect, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import type { GithubAuthState, GithubPullRequestSummary } from '@shared/types';
import { cn } from '../utils/cn';

export default function PullRequestsView() {
  const { state, dispatch, toast } = useApp();
  const [prs, setPrs] = useState<GithubPullRequestSummary[]>([]);
  const [auth, setAuth] = useState<GithubAuthState | null>(null);
  const [loading, setLoading] = useState(false);

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

  const checkout = async (pr: GithubPullRequestSummary) => {
    try {
      const session = await api.ghPrCheckout(repo.id, pr.number);
      dispatch({ type: 'setSession', session });
      dispatch({ type: 'setPrNumber', n: pr.number });
      dispatch({ type: 'view', view: 'pr-detail' });
      toast('success', `Opened PR #${pr.number}`);
    } catch (e) {
      toast('error', (e as Error).message);
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
              {prs.map((pr) => (
                <li
                  key={pr.number}
                  className="px-4 py-3 border-b last:border-b-0 border-border hover:bg-bg-subtle cursor-pointer"
                  onDoubleClick={() => void checkout(pr)}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn('chip', pr.isDraft && 'text-text-muted')}>#{pr.number}</span>
                    <span className="text-sm font-medium truncate flex-1">{pr.title}</span>
                    <span className="small-mono">{pr.author}</span>
                    <span className="small-mono">
                      {pr.headRef} → {pr.baseRef}
                    </span>
                    <button className="btn-primary h-8" onClick={() => void checkout(pr)}>
                      Open
                    </button>
                    <button
                      className="btn-ghost h-8 w-8 p-0"
                      onClick={() => void api.openExternal(pr.url)}
                      title="Open in browser"
                    >
                      ↗
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
