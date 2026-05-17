import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';
import type {
  GithubAccount,
  GithubIssueDetail,
  GithubIssueLabel,
  GithubIssueStateFilter,
  GithubIssueSummary,
} from '@shared/types';

const FILTERS: { id: GithubIssueStateFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

export default function IssuesView() {
  const { state, toast } = useApp();
  const repo = state.repo;
  const [accounts, setAccounts] = useState<GithubAccount[]>([]);
  const [issues, setIssues] = useState<GithubIssueSummary[]>([]);
  const [detail, setDetail] = useState<GithubIssueDetail | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [filter, setFilter] = useState<GithubIssueStateFilter>('open');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const boundAccount = repo?.github_account_id
    ? accounts.find((a) => a.id === repo.github_account_id) ?? null
    : null;

  const load = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      const authState = await api.ghAuthList();
      setAccounts(authState.accounts);
      if (
        authState.accounts.length > 0 &&
        repo.github_owner &&
        repo.github_repo &&
        repo.github_account_id != null
      ) {
        const nextIssues = await api.ghIssueList(repo.id, filter);
        setIssues(nextIssues);
        setSelectedNumber((current) =>
          nextIssues.some((issue) => issue.number === current)
            ? current
            : nextIssues[0]?.number ?? null,
        );
        if (nextIssues.length === 0) setDetail(null);
      } else {
        setIssues([]);
        setSelectedNumber(null);
        setDetail(null);
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

  useEffect(() => {
    if (!repo || selectedNumber == null) return;
    let cancelled = false;
    void (async () => {
      setDetailLoading(true);
      try {
        const nextDetail = await api.ghIssueDetail(repo.id, selectedNumber);
        if (!cancelled) setDetail(nextDetail);
      } catch (e) {
        if (!cancelled) toast('error', (e as Error).message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, selectedNumber, toast]);

  const filteredIssues = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter((issue) => {
      const haystack = [
        issue.title,
        `#${issue.number}`,
        issue.author,
        ...issue.labels.map((label) => label.name),
        ...issue.assignees.map((assignee) => assignee.login),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [issues, query]);

  if (!repo) return null;

  const selectedIssue = issues.find((issue) => issue.number === selectedNumber) ?? null;
  const connectedToGithub = !!(repo.github_owner && repo.github_repo);

  return (
    <div className="h-full w-full min-h-0 bg-bg-panel">
      <section className="h-full min-h-0 bg-bg grid grid-rows-[auto_minmax(0,1fr)]">
        <header className="px-6 py-4 border-b border-border bg-bg grid grid-cols-[1fr_auto] items-center gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Issues</h1>
            <p className="text-sm text-text-muted mt-1 truncate">
              {connectedToGithub
                ? `${repo.github_owner}/${repo.github_repo}`
                : 'No GitHub remote detected'}
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
              <RefreshCw size={14} strokeWidth={2} className={cn(loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </header>

        {!connectedToGithub ? (
          <div className="p-6">
            <div className="panel-card p-6 text-sm text-text-secondary">
              <p>This repository has no GitHub remote we recognized.</p>
              <p className="text-text-muted text-xs mt-2 font-mono">
                (Looked for an origin URL like git@github.com:owner/repo or https://github.com/owner/repo.)
              </p>
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-6">
            <div className="panel-card p-6 text-sm text-text-secondary">
              Sign in to GitHub from the toolbar (top right) to view issues.
            </div>
          </div>
        ) : repo.github_account_id == null ? (
          <div className="p-6">
            <div className="panel-card p-6 text-sm text-text-secondary">
              This repository isn't bound to any GitHub account. Open the account menu in the top
              bar to assign one.
            </div>
          </div>
        ) : (
          <div className="min-h-0 p-4">
            <div className="panel-card h-full min-h-0 grid grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
              <aside className="min-h-0 border-r border-border grid grid-rows-[auto_minmax(0,1fr)]">
                <div className="p-3 border-b border-border">
                  <label className="relative block">
                    <Search
                      size={14}
                      strokeWidth={2}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                    />
                    <input
                      className="input h-8 pl-8"
                      placeholder="Search issues"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                <div className="min-h-0 overflow-auto">
                  {loading && (
                    <div className="px-3 py-3 text-sm text-text-muted flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Loading…
                    </div>
                  )}
                  {!loading && filteredIssues.length === 0 && (
                    <div className="px-3 py-3 text-sm text-text-muted">
                      {issues.length === 0 ? `No ${filter === 'all' ? '' : `${filter} `}issues.` : 'No matching issues.'}
                    </div>
                  )}
                  <ul>
                    {filteredIssues.map((issue) => (
                      <IssueListItem
                        key={issue.number}
                        issue={issue}
                        selected={issue.number === selectedNumber}
                        onClick={() => {
                          setSelectedNumber(issue.number);
                          if (detail?.number !== issue.number) setDetail(null);
                        }}
                      />
                    ))}
                  </ul>
                </div>
              </aside>

              <main className="min-h-0 overflow-auto">
                {selectedIssue ? (
                  <IssueDetailPane
                    issue={selectedIssue}
                    detail={detail?.number === selectedIssue.number ? detail : null}
                    loading={detailLoading}
                    onOpenBrowser={() => void api.ghIssueOpenInBrowser(repo.id, selectedIssue.number)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-text-muted">
                    Select an issue.
                  </div>
                )}
              </main>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function IssueListItem({
  issue,
  selected,
  onClick,
}: {
  issue: GithubIssueSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        className={cn(
          'w-full text-left px-3 py-3 grid gap-2 hover:bg-bg-subtle transition-colors',
          selected && 'bg-bg-subtle',
        )}
        onClick={onClick}
      >
        <div className="flex items-start gap-2 min-w-0">
          <IssueStateIcon state={issue.state} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug line-clamp-2">{issue.title}</div>
            <div className="mt-1 flex items-center gap-2 min-w-0 small-mono">
              <span>#{issue.number}</span>
              <span className="truncate">{issue.author}</span>
              {issue.commentsCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare size={12} strokeWidth={2} />
                  {issue.commentsCount}
                </span>
              )}
            </div>
          </div>
        </div>
        {issue.labels.length > 0 && <IssueLabels labels={issue.labels} compact />}
      </button>
    </li>
  );
}

function IssueDetailPane({
  issue,
  detail,
  loading,
  onOpenBrowser,
}: {
  issue: GithubIssueSummary;
  detail: GithubIssueDetail | null;
  loading: boolean;
  onOpenBrowser: () => void;
}) {
  const body = detail?.body ?? '';
  const comments = detail?.comments ?? [];

  return (
    <article className="min-h-full bg-bg-panel">
      <header className="sticky top-0 z-10 bg-bg-panel border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
              <IssueStateIcon state={issue.state} />
              <span>#{issue.number}</span>
              <span>opened by {issue.author}</span>
              <span>updated {formatDate(issue.updatedAt)}</span>
            </div>
            <h2 className="mt-1.5 text-lg font-semibold leading-tight">{issue.title}</h2>
          </div>
          <button className="btn shrink-0" onClick={onOpenBrowser}>
            <ExternalLink size={14} strokeWidth={2} />
            Open on GitHub
          </button>
        </div>
        {(issue.labels.length > 0 || issue.assignees.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {issue.labels.length > 0 && <IssueLabels labels={issue.labels} />}
            {issue.assignees.map((assignee) => (
              <span key={assignee.login} className="chip">
                @{assignee.login}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="p-5 grid gap-4">
        <section className="border border-border rounded-card overflow-hidden">
          <div className="px-3 py-2 bg-bg-subtle border-b border-border small-mono">
            {issue.author} commented {formatDate(issue.createdAt)}
          </div>
          <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {loading && !detail ? (
              <span className="text-text-muted inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Loading…
              </span>
            ) : body.trim() ? (
              body
            ) : (
              <span className="text-text-muted">No description provided.</span>
            )}
          </div>
        </section>

        <section className="border border-border rounded-card overflow-hidden">
          <div className="px-3 py-2 bg-bg-subtle border-b border-border flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-text-secondary">Comments</span>
            <span className="small-mono">{comments.length}</span>
          </div>
          {loading && !detail ? (
            <div className="px-3 py-3 text-sm text-text-muted flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Loading comments…
            </div>
          ) : comments.length === 0 ? (
            <div className="px-3 py-3 text-sm text-text-muted">No comments.</div>
          ) : (
            <div>
              {comments.map((comment) => (
                <div key={comment.id} className="border-b border-border last:border-b-0">
                  <div className="px-3 py-2 bg-bg-subtle/60 border-b border-border small-mono">
                    {comment.author} commented {formatDate(comment.createdAt)}
                  </div>
                  <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {comment.body.trim() || <span className="text-text-muted">No comment body.</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function IssueLabels({ labels, compact = false }: { labels: GithubIssueLabel[]; compact?: boolean }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5 min-w-0', compact && 'max-h-[44px] overflow-hidden')}>
      {labels.map((label) => (
        <span key={`${label.name}-${label.color ?? ''}`} className="tag max-w-[180px]" title={label.description ?? label.name}>
          <span
            className="w-2 h-2 rounded-full border border-border-strong shrink-0"
            style={{ backgroundColor: cssLabelColor(label.color) }}
          />
          <span className="truncate">{label.name}</span>
        </span>
      ))}
    </div>
  );
}

function IssueStateIcon({
  state,
  className,
}: {
  state: GithubIssueSummary['state'];
  className?: string;
}) {
  const Icon = state === 'open' ? CircleDot : CheckCircle2;
  return (
    <Icon
      size={15}
      strokeWidth={2.25}
      className={cn(state === 'open' ? 'text-success' : 'text-text-muted', className)}
      aria-label={state}
    />
  );
}

function cssLabelColor(color: string | null): string | undefined {
  if (!color || !/^[0-9a-f]{6}$/i.test(color)) return undefined;
  return `#${color}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
