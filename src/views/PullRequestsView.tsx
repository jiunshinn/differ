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
      toast('success', `Checked out PR #${pr.number}`);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  if (!repo.github_owner || !repo.github_repo) {
    return (
      <div className="p-6 text-text-secondary text-sm">
        <p>This repository has no GitHub remote we recognized.</p>
        <p className="text-text-muted text-xs mt-1">
          (Looked for an origin URL like git@github.com:owner/repo or https://github.com/owner/repo.)
        </p>
      </div>
    );
  }

  if (auth && !auth.authenticated) {
    return (
      <div className="p-6 text-sm text-text-secondary">
        Sign in to GitHub from the top-right menu to view pull requests.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-9 px-3 flex items-center gap-2 border-b border-border">
        <div className="text-sm">
          {repo.github_owner}/{repo.github_repo} · Pull requests
        </div>
        <div className="flex-1" />
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && <div className="p-4 text-text-muted text-sm">Loading…</div>}
        {!loading && prs.length === 0 && <div className="p-4 text-text-muted text-sm">No open pull requests.</div>}
        <ul>
          {prs.map((pr) => (
            <li
              key={pr.number}
              className="px-3 py-2 border-b border-border-subtle hover:bg-bg-subtle cursor-pointer"
              onDoubleClick={() => void checkout(pr)}
            >
              <div className="flex items-center gap-2">
                <span className={cn('tag', pr.isDraft && 'text-text-muted')}>#{pr.number}</span>
                <span className="text-sm font-medium truncate flex-1">{pr.title}</span>
                <span className="text-xs text-text-muted">{pr.author}</span>
                <span className="text-xs text-text-muted">
                  {pr.headRef} → {pr.baseRef}
                </span>
                <button className="btn-primary" onClick={() => void checkout(pr)}>
                  Open
                </button>
                <button
                  className="btn-ghost"
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
    </div>
  );
}
