import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp, type ActivityEvent, type ActivityKind, type RightPanelTab } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import type { CommentLabel, GithubCheckRun, ReviewComment } from '@shared/types';

export default function ReviewPanel() {
  const { state, dispatch } = useApp();
  const session = state.session;
  const repo = state.repo;
  const tab = state.rightPanelTab;

  if (!repo) return null;

  const headerTitle =
    session?.kind === 'pull_request' && state.prNumber
      ? `PR #${state.prNumber}`
      : 'Local review';
  const headerMeta = session
    ? session.kind === 'pull_request'
      ? `${session.branch ?? '?'} → ${session.base_branch ?? '?'}`
      : `${session.branch ?? '(detached)'} · local working tree`
    : 'Open a session';

  return (
    <aside className="grid grid-rows-[auto_auto_1fr] min-w-0 bg-bg-panel border-l border-border overflow-hidden">
      <header className="px-3.5 py-3 border-b border-border bg-bg-panel">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold text-base tracking-tight m-0 leading-tight truncate">{headerTitle}</h2>
          {session?.kind === 'pull_request' && state.prNumber && (
            <button
              className="btn-ghost h-7 text-xs px-2"
              onClick={() => void api.ghPrOpenInBrowser(repo.id, state.prNumber!)}
              title="Open PR on GitHub"
            >
              ↗
            </button>
          )}
        </div>
        <div className="mt-1 text-xs text-text-muted font-mono truncate">{headerMeta}</div>
      </header>

      <div className="px-3.5 pt-3 flex gap-1">
        <TabButton active={tab === 'overview'} onClick={() => dispatch({ type: 'setRightPanelTab', tab: 'overview' })}>
          Overview
        </TabButton>
        <TabButton active={tab === 'comments'} onClick={() => dispatch({ type: 'setRightPanelTab', tab: 'comments' })}>
          Comments
          <span className="ml-1 text-text-muted">{state.comments.length}</span>
        </TabButton>
        <TabButton active={tab === 'context'} onClick={() => dispatch({ type: 'setRightPanelTab', tab: 'context' })}>
          Context
          <span className="ml-1 text-text-muted">
            {state.selectedCommentIds.length + state.selectedHunkKeys.length + state.selectedFilePaths.length}
          </span>
        </TabButton>
      </div>

      <div className="min-h-0 overflow-auto px-3.5 py-3 grid gap-3.5 content-start">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'comments' && <CommentsTab />}
        {tab === 'context' && <ContextTab />}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'h-7 px-2.5 rounded-md text-xs font-medium border',
        active
          ? 'bg-bg-panel border-border text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-primary hover:bg-bg-subtle',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function OverviewTab() {
  const { state } = useApp();
  const session = state.session;

  return (
    <>
      {session?.kind === 'pull_request' ? <ChecksCard /> : <LocalStateCard />}
      <TimelineCard />
    </>
  );
}

function LocalStateCard() {
  const { state } = useApp();
  const status = state.status;
  const open = state.comments.filter((c) => c.status === 'open').length;
  const resolved = state.comments.filter((c) => c.status === 'resolved').length;
  const reviewed = state.fileStates.filter((f) => f.status === 'reviewed').length;
  return (
    <section className="panel-card">
      <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
        <strong className="font-semibold tracking-tight">Local state</strong>
        <span className="chip">working tree</span>
      </header>
      <div>
        <StateRow label="Files changed" value={String(state.files.length)} tone="neutral" />
        <StateRow
          label="Ahead / behind"
          value={status ? `↑${status.ahead} ↓${status.behind}` : '—'}
          tone={status && (status.ahead || status.behind) ? 'warn' : 'success'}
        />
        <StateRow label="Open comments" value={String(open)} tone={open ? 'warn' : 'success'} />
        <StateRow label="Reviewed files" value={`${reviewed} / ${state.files.length}`} tone="neutral" />
        <StateRow label="Resolved comments" value={String(resolved)} tone="neutral" />
      </div>
    </section>
  );
}

function ChecksCard() {
  const { state, toast } = useApp();
  const repo = state.repo!;
  const session = state.session;
  const ref = session?.head_sha;

  const [checks, setChecks] = useState<GithubCheckRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!ref) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.ghPrChecks(repo.id, ref);
      setChecks(list);
    } catch (e) {
      setError((e as Error).message);
      toast('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  return (
    <section className="panel-card">
      <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
        <strong className="font-semibold tracking-tight">GitHub checks</strong>
        <button
          className="btn-ghost h-7 px-2 inline-flex items-center justify-center"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh checks"
          title="Refresh checks"
        >
          <RefreshCw size={13} strokeWidth={2} className={cn(loading && 'animate-spin')} />
        </button>
      </header>
      <div>
        {error && <div className="px-3 py-3 text-sm text-danger">{error}</div>}
        {!error && checks == null && (
          <div className="px-3 py-3 text-sm text-text-muted">{loading ? 'Loading…' : 'No data.'}</div>
        )}
        {checks != null && checks.length === 0 && (
          <div className="px-3 py-3 text-sm text-text-muted">No checks reported for this ref.</div>
        )}
        {checks?.map((c) => (
          <CheckRow key={c.id} run={c} />
        ))}
      </div>
    </section>
  );
}

function CheckRow({ run }: { run: GithubCheckRun }) {
  const tone =
    run.conclusion === 'success'
      ? 'success'
      : run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'action_required'
      ? 'danger'
      : run.status !== 'completed'
      ? 'warn'
      : 'neutral';
  const dotClass =
    tone === 'success'
      ? 'bg-success'
      : tone === 'danger'
      ? 'bg-danger'
      : tone === 'warn'
      ? 'bg-warn'
      : 'bg-text-muted';
  const label =
    run.status !== 'completed'
      ? run.status.replace('_', ' ')
      : run.conclusion ?? 'completed';
  return (
    <div className="flex items-center justify-between gap-2 min-h-[38px] px-3 py-2 border-b last:border-b-0 border-border">
      <span className="flex items-center text-sm truncate">
        <span className={cn('inline-block w-2 h-2 rounded-full mr-2 flex-none', dotClass)} />
        <span className="truncate" title={run.name}>
          {run.name}
        </span>
      </span>
      <span className="small-mono whitespace-nowrap">{label}</span>
    </div>
  );
}

function StateRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warn' | 'neutral';
}) {
  const dot =
    tone === 'success' ? 'bg-success' : tone === 'warn' ? 'bg-warn' : 'bg-text-muted';
  return (
    <div className="flex items-center justify-between gap-2 min-h-[38px] px-3 py-2 border-b last:border-b-0 border-border">
      <span className="flex items-center text-sm">
        <span className={cn('inline-block w-2 h-2 rounded-full mr-2', dot)} />
        {label}
      </span>
      <span className="small-mono">{value}</span>
    </div>
  );
}

function TimelineCard() {
  const { state } = useApp();
  const events = state.activity;
  return (
    <section className="panel-card">
      <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
        <strong className="font-semibold tracking-tight">Review timeline</strong>
        <span className="small-mono">{events.length ? 'live' : 'idle'}</span>
      </header>
      <div className="px-3 py-3 grid gap-3">
        {events.length === 0 && (
          <p className="text-sm text-text-muted m-0">
            Local activity (comments, stages, commits) will appear here.
          </p>
        )}
        {events.map((event) => (
          <TimelineRow key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}

function TimelineRow({ event }: { event: ActivityEvent }) {
  const initials = kindInitials(event.kind);
  return (
    <div className="grid grid-cols-[24px_1fr] gap-2.5 items-start">
      <span className="w-[22px] h-[22px] rounded-full bg-text-primary text-bg-panel grid place-items-center font-mono text-[10px]">
        {initials}
      </span>
      <div className="min-w-0">
        <p className="m-0 text-sm">{event.message}</p>
        <div className="mt-0.5 small-mono truncate">
          {event.detail ? `${event.detail} · ` : ''}
          {new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

function kindInitials(kind: ActivityKind): string {
  switch (kind) {
    case 'comment_created':
      return 'C+';
    case 'comment_resolved':
      return 'C✓';
    case 'file_staged':
      return 'S+';
    case 'file_unstaged':
      return 'S−';
    case 'file_reviewed':
      return 'R✓';
    case 'commit':
      return 'GC';
    case 'pull':
      return 'GP';
    case 'push':
      return 'G↑';
    case 'fetch':
      return 'GF';
    case 'context_copied':
      return 'CX';
    case 'context_extracted':
      return 'EX';
    default:
      return '·';
  }
}

function CommentsTab() {
  const { state, dispatch, loadComments, toast, logActivity } = useApp();
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved' | 'ask-ai'>('all');
  const comments = useMemo(() => {
    if (filter === 'open') return state.comments.filter((c) => c.status === 'open');
    if (filter === 'resolved') return state.comments.filter((c) => c.status === 'resolved');
    if (filter === 'ask-ai') return state.comments.filter((c) => c.label === 'ask-ai');
    return state.comments;
  }, [state.comments, filter]);

  const onToggleSelect = (id: number) => dispatch({ type: 'toggleCommentSelection', id });
  const onDelete = async (id: number) => {
    try {
      await api.deleteComment(id);
      await loadComments();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const onResolve = async (c: ReviewComment) => {
    try {
      await api.updateComment(c.id, { status: c.status === 'open' ? 'resolved' : 'open' });
      logActivity({
        kind: 'comment_resolved',
        message: c.status === 'open' ? 'Resolved comment' : 'Reopened comment',
        detail: c.file_path,
      });
      await loadComments();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const select = (filePath: string) => dispatch({ type: 'setSelectedFile', filePath });

  return (
    <section className="panel-card">
      <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
        <strong className="font-semibold tracking-tight">Comments</strong>
        <div className="flex gap-1">
          {(['all', 'open', 'resolved', 'ask-ai'] as const).map((f) => (
            <button
              key={f}
              className={cn(
                'h-6 px-1.5 rounded-md text-[11px] border',
                filter === f
                  ? 'bg-bg border-border text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-primary',
              )}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </header>
      <div className="grid gap-1.5 p-2.5">
        {!comments.length && <div className="text-sm text-text-muted px-1.5 py-3">No comments.</div>}
        {comments.map((c) => (
          <article key={c.id} className="border border-border rounded-card p-2.5">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={state.selectedCommentIds.includes(c.id)}
                onChange={() => onToggleSelect(c.id)}
              />
              <div className="flex-1 min-w-0">
                <button
                  className="text-xs font-mono text-text-secondary truncate hover:text-accent text-left w-full"
                  onClick={() => select(c.file_path)}
                  title={c.file_path}
                >
                  {c.file_path}
                </button>
                <div className="text-[11px] text-text-muted">
                  {c.target_kind}
                  {c.target_kind === 'line' && c.line_number != null
                    ? ` ${c.diff_side === 'old' ? '−' : '+'}${c.line_number}`
                    : ''}
                  {c.target_kind === 'hunk' && c.hunk_header ? ` ${c.hunk_header}` : ''}
                  {c.label && <span className="ml-1 chip">{c.label}</span>}
                  {c.status === 'resolved' && <span className="ml-1 text-success">✓</span>}
                </div>
                <div className="whitespace-pre-wrap text-sm mt-1">{c.body}</div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button className="btn-ghost h-7 text-[11px] px-2" onClick={() => void onResolve(c)}>
                    {c.status === 'open' ? 'Resolve' : 'Reopen'}
                  </button>
                  <LabelChooser comment={c} />
                  <button
                    className="btn-ghost h-7 text-[11px] px-2 text-danger"
                    onClick={() => void onDelete(c.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function LabelChooser({ comment }: { comment: ReviewComment }) {
  const { loadComments, toast } = useApp();
  const onChange = async (label: CommentLabel) => {
    try {
      await api.updateComment(comment.id, { label });
      await loadComments();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <select
      className="bg-bg-panel border border-border rounded-md text-[11px] py-1 px-1.5"
      value={comment.label ?? ''}
      onChange={(e) => void onChange((e.target.value || null) as CommentLabel)}
    >
      <option value="">(no label)</option>
      <option value="issue">issue</option>
      <option value="question">question</option>
      <option value="refactor">refactor</option>
      <option value="test">test</option>
      <option value="ask-ai">ask-ai</option>
    </select>
  );
}

function ContextTab() {
  const { state, dispatch, toast, logActivity } = useApp();
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  const hunks = useMemo(
    () =>
      state.selectedHunkKeys.map((k) => {
        const idx = k.indexOf('::');
        return { filePath: k.slice(0, idx), hunkHeader: k.slice(idx + 2) };
      }),
    [state.selectedHunkKeys],
  );

  useEffect(() => {
    let cancelled = false;
    const sessionId = state.session?.id;
    if (!sessionId) {
      setPreview('');
      return;
    }
    const hasAny =
      state.selectedCommentIds.length || state.selectedFilePaths.length || state.selectedHunkKeys.length;
    if (!hasAny) {
      setPreview('');
      return;
    }
    setBusy(true);
    api
      .previewContext({
        sessionId,
        task: 'Review the selected changes and improve where appropriate.',
        includeRepoMetadata: true,
        includeFullFiles: false,
        commentIds: state.selectedCommentIds,
        filePaths: state.selectedFilePaths,
        hunks,
      })
      .then((r) => {
        if (!cancelled) setPreview(r.markdown);
      })
      .catch((e) => {
        if (!cancelled) toast('error', (e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    state.session?.id,
    state.selectedCommentIds.join('|'),
    state.selectedFilePaths.join('|'),
    state.selectedHunkKeys.join('|'),
    hunks,
    toast,
  ]);

  const copy = async () => {
    try {
      await api.copyContext(preview);
      logActivity({ kind: 'context_copied', message: 'Copied context to clipboard' });
      toast('success', 'Context copied to clipboard');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const counts = `${state.selectedCommentIds.length} comments · ${state.selectedHunkKeys.length} hunks · ${state.selectedFilePaths.length} files`;

  return (
    <>
      <section className="panel-card">
        <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
          <strong className="font-semibold tracking-tight">Extracted context</strong>
          <span className="small-mono">{counts}</span>
        </header>
        <pre className="m-0 p-3 max-h-[280px] overflow-auto bg-bg border-b border-border font-mono text-xs leading-[1.55] whitespace-pre-wrap text-text-primary">
          {busy ? 'Generating…' : preview || 'Select comments, hunks, or files to build a context bundle.'}
        </pre>
        <div className="grid grid-cols-2 gap-2 p-3">
          <button
            className="btn"
            onClick={() => dispatch({ type: 'view', view: 'context' })}
          >
            Open builder
          </button>
          <button className="btn-primary" disabled={!preview} onClick={() => void copy()}>
            Copy markdown
          </button>
        </div>
      </section>
      <section className="panel-card">
        <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
          <strong className="font-semibold tracking-tight">Selections</strong>
          <button className="btn-ghost h-7 text-xs px-2" onClick={() => dispatch({ type: 'clearSelections' })}>
            Clear
          </button>
        </header>
        <SelectionsList />
      </section>
    </>
  );
}

function SelectionsList() {
  const { state, dispatch } = useApp();
  return (
    <div className="p-3 grid gap-3">
      <SelectionSection title={`Comments (${state.selectedCommentIds.length})`}>
        {state.comments
          .filter((c) => state.selectedCommentIds.includes(c.id))
          .map((c) => (
            <SelRow key={c.id} onClear={() => dispatch({ type: 'toggleCommentSelection', id: c.id, on: false })}>
              <span className="font-mono">{c.file_path}</span> {c.target_kind}
              {c.line_number ? ` L${c.line_number}` : ''}
            </SelRow>
          ))}
      </SelectionSection>
      <SelectionSection title={`Hunks (${state.selectedHunkKeys.length})`}>
        {state.selectedHunkKeys.map((k) => (
          <SelRow key={k} onClear={() => dispatch({ type: 'toggleHunkSelection', key: k, on: false })}>
            <span className="font-mono">{k}</span>
          </SelRow>
        ))}
      </SelectionSection>
      <SelectionSection title={`Files (${state.selectedFilePaths.length})`}>
        {state.selectedFilePaths.map((p) => (
          <SelRow key={p} onClear={() => dispatch({ type: 'toggleFileSelection', path: p, on: false })}>
            <span className="font-mono">{p}</span>
          </SelRow>
        ))}
      </SelectionSection>
    </div>
  );
}

function SelectionSection({ title, children }: { title: string; children: React.ReactNode }) {
  const isEmpty = React.Children.count(children) === 0;
  return (
    <div>
      <div className="section-label mb-1.5">{title}</div>
      <ul className="border border-border rounded-card p-1.5">
        {isEmpty ? <li className="text-xs text-text-muted py-1 px-1.5">None.</li> : children}
      </ul>
    </div>
  );
}

function SelRow({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <li className="text-xs flex items-center justify-between gap-2 py-1 px-1.5">
      <span className="truncate flex-1">{children}</span>
      <button className="btn-ghost h-6 w-6 p-0 text-text-muted hover:text-danger" onClick={onClear}>
        ×
      </button>
    </li>
  );
}
