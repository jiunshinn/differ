import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GitPullRequest, Loader2, Search, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../state/AppStore';
import { api } from '../api';
import { useGithubAuthQuery, useGithubPullRequestsQuery } from '../query/hooks';
import type { GithubPullRequestState, GithubPullRequestStateFilter, GithubPullRequestSummary } from '@shared/types';
import { cn } from '../utils/cn';

const FILTERS: { id: GithubPullRequestStateFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'merged', label: 'Merged' },
  { id: 'all', label: 'All' },
];

type ReviewQueue = 'for-me' | 'created' | 'all';

const QUEUES: { id: ReviewQueue; label: string }[] = [
  { id: 'for-me', label: 'For me' },
  { id: 'created', label: 'Created' },
  { id: 'all', label: 'All' },
];
const EMPTY_PRS: GithubPullRequestSummary[] = [];

export default function PullRequestsView() {
  const repo = useAppStore((state) => state.repo);
  const setSession = useAppStore((state) => state.setSession);
  const setPrNumber = useAppStore((state) => state.setPrNumber);
  const setView = useAppStore((state) => state.setView);
  const toast = useAppStore((state) => state.showToast);
  const [filter, setFilter] = useState<GithubPullRequestStateFilter>('open');
  const [queue, setQueue] = useState<ReviewQueue>('for-me');
  const [query, setQuery] = useState('');

  const hasGithubRemote = !!repo?.github_owner && !!repo.github_repo;
  const authQuery = useGithubAuthQuery();
  const accounts = authQuery.data?.accounts ?? [];
  const boundAccount = repo?.github_account_id
    ? accounts.find((a) => a.id === repo.github_account_id) ?? null
    : null;
  const canLoadReviews = hasGithubRemote && accounts.length > 0 && repo?.github_account_id != null;
  const prsQuery = useGithubPullRequestsQuery(repo?.id ?? null, filter, canLoadReviews);
  const prs = useMemo(
    () => (canLoadReviews ? prsQuery.data ?? EMPTY_PRS : EMPTY_PRS),
    [canLoadReviews, prsQuery.data],
  );
  const loading = authQuery.isLoading || prsQuery.isFetching;
  const openPrMutation = useMutation({
    mutationFn: ({ repoId, pr }: { repoId: number; pr: GithubPullRequestSummary }) =>
      api.ghPrCheckout(repoId, pr.number),
    onSuccess: (session, { repoId, pr }) => {
      // ghPrCheckout runs network fetches and can take seconds. If the user
      // switched repositories meanwhile, don't apply this (now-stale) PR session
      // against the new repo.
      if (useAppStore.getState().repo?.id !== repoId) return;
      setSession(session);
      setPrNumber(pr.number);
      setView('pr-detail');
    },
    onError: (e) => toast('error', (e as Error).message),
  });

  const visiblePrs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prs.filter((pr) => {
      if (queue === 'for-me' && boundAccount && pr.author === boundAccount.login) return false;
      if (queue === 'created' && boundAccount && pr.author !== boundAccount.login) return false;
      if (!q) return true;
      return [pr.title, `#${pr.number}`, pr.author, pr.headRef, pr.baseRef].some((value) =>
        value.toLowerCase().includes(q),
      );
    });
  }, [boundAccount, prs, query, queue]);

  const queueCounts = useMemo(() => {
    const authored = boundAccount ? prs.filter((pr) => pr.author === boundAccount.login).length : 0;
    return {
      'for-me': boundAccount ? prs.length - authored : prs.length,
      created: authored,
      all: prs.length,
    } satisfies Record<ReviewQueue, number>;
  }, [boundAccount, prs]);

  if (!repo) return null;

  const openPr = async (pr: GithubPullRequestSummary) => {
    if (openPrMutation.isPending || !repo) return;
    try {
      await openPrMutation.mutateAsync({ repoId: repo.id, pr });
    } catch {
      // onError already surfaced the message.
    }
  };

  const opening = openPrMutation.isPending ? openPrMutation.variables?.pr.number ?? null : null;

  return (
    <div className="h-full w-full min-h-0 bg-bg-panel">
      <section className="h-full min-h-0 bg-bg grid grid-rows-[auto_minmax(0,1fr)]">
        <header className="px-4 py-3 border-b border-border bg-bg-panel flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Reviews</h1>
            <p className="text-sm text-text-muted mt-1 truncate">
              {hasGithubRemote ? `${repo.github_owner}/${repo.github_repo}` : 'No GitHub remote detected'}
              {boundAccount && (
                <>
                  {' '}
                  · <span className="text-text-muted">as</span>{' '}
                  <span className="text-accent">@{boundAccount.login}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                className="input h-8 w-[240px] pl-8 text-sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search reviews"
              />
            </div>
            <div className="inline-flex bg-bg border border-border rounded-lg p-[3px] gap-1">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    'h-7 px-2.5 rounded-md text-xs font-medium',
                    filter === item.id
                      ? 'bg-bg-panel text-text-primary border border-border'
                      : 'text-text-muted hover:text-text-primary',
                  )}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              className="btn h-8 inline-flex items-center gap-1.5"
              onClick={() => {
                void authQuery.refetch();
                void prsQuery.refetch();
              }}
              disabled={loading}
            >
              <SlidersHorizontal size={14} />
              Refresh
            </button>
          </div>
        </header>

        <div className="min-h-0 grid grid-cols-[280px_minmax(0,1fr)]">
          <aside className="border-r border-border bg-bg-panel min-h-0 overflow-auto p-3.5">
            <div className="section-label mb-2">Review queues</div>
            <div className="grid gap-1.5">
              {QUEUES.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    'h-9 px-2.5 rounded-lg border text-sm flex items-center justify-between gap-2',
                    queue === item.id
                      ? 'bg-bg border-border text-text-primary shadow-card'
                      : 'border-transparent text-text-secondary hover:bg-bg-subtle',
                  )}
                  onClick={() => setQueue(item.id)}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="small-mono">{queueCounts[item.id]}</span>
                </button>
              ))}
            </div>

            <section className="panel-card mt-3.5">
              <header className="px-3 py-2.5 border-b border-border">
                <strong className="text-sm font-semibold">Review status</strong>
              </header>
              <StatusRow label="Open" value={prs.filter((pr) => pr.state === 'open' && !pr.isDraft).length} tone="success" />
              <StatusRow label="Draft" value={prs.filter((pr) => pr.isDraft).length} tone="neutral" />
              <StatusRow label="Merged" value={prs.filter((pr) => pr.state === 'merged').length} tone="accent" />
            </section>
          </aside>

          <main className="min-h-0 overflow-auto p-3.5">
            {!hasGithubRemote ? (
              <EmptyCard
                title="No GitHub remote"
                body="Differ looked for an origin URL like git@github.com:owner/repo or https://github.com/owner/repo."
              />
            ) : accounts.length === 0 ? (
              <EmptyCard title="Sign in to GitHub" body="Sign in from the toolbar to review pull requests." />
            ) : repo.github_account_id == null ? (
              <EmptyCard title="Bind a GitHub account" body="Open the account menu in the top bar and assign an account to this repository." />
            ) : (
              <div className="panel-card overflow-hidden">
                <div className="h-10 px-3 border-b border-border bg-bg-subtle flex items-center justify-between">
                  <strong className="text-sm font-semibold">
                    {QUEUES.find((item) => item.id === queue)?.label ?? 'Reviews'}
                  </strong>
                  <span className="small-mono">
                    {loading ? 'loading' : `${visiblePrs.length} of ${prs.length}`}
                  </span>
                </div>
                {loading && <div className="px-4 py-3 text-text-muted text-sm">Loading reviews...</div>}
                {!loading && visiblePrs.length === 0 && (
                  <div className="px-4 py-6 text-text-muted text-sm">
                    {canLoadReviews ? 'No reviews match this queue.' : 'Reviews are not available.'}
                  </div>
                )}
                <ul>
                  {visiblePrs.map((pr) => {
                    const isOpening = opening === pr.number;
                    const isDisabled = opening != null && !isOpening;
                    return (
                      <li
                        key={pr.number}
                        className={cn(
                          'px-4 py-3 border-b last:border-b-0 border-border',
                          isDisabled ? 'opacity-50 pointer-events-none' : 'hover:bg-bg-subtle cursor-pointer',
                          isOpening && 'bg-bg-subtle',
                        )}
                        onClick={() => void openPr(pr)}
                      >
                        <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <GitPullRequest size={15} className="text-success flex-none" />
                              <span className="text-sm font-semibold truncate">{pr.title}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-text-muted font-mono min-w-0">
                              <span>#{pr.number}</span>
                              <PrStateChip state={pr.state} isDraft={pr.isDraft} />
                              <span className="truncate">{pr.author}</span>
                              <span className="truncate">
                                {pr.headRef} to {pr.baseRef}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-text-muted">
                            {pr.author !== boundAccount?.login && pr.state === 'open' && (
                              <span className="chip text-warn border-warn/30">Needs review</span>
                            )}
                            {isOpening && (
                              <span className="flex items-center gap-1.5 small-mono">
                                <Loader2 size={13} className="animate-spin" />
                                Opening...
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'accent' | 'neutral';
}) {
  const dot = tone === 'success' ? 'bg-success' : tone === 'accent' ? 'bg-accent' : 'bg-text-muted';
  return (
    <div className="flex items-center justify-between gap-2 min-h-[36px] px-3 py-2 border-b last:border-b-0 border-border">
      <span className="text-sm flex items-center">
        <span className={cn('inline-block w-2 h-2 rounded-full mr-2', dot)} />
        {label}
      </span>
      <span className="small-mono">{value}</span>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel-card p-6 text-sm text-text-secondary">
      <strong className="block text-text-primary mb-1">{title}</strong>
      {body}
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
