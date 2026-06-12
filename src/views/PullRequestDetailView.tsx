import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleDot,
  ExternalLink,
  GitPullRequest,
  MessageSquare,
} from 'lucide-react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import { formatDateTime } from '../utils/date';
import CommentComposer from '../components/CommentComposer';
import ResizableLayout from '../components/ResizableLayout';
import { ActivityView, PrSummaryPanel } from '../components/pr/PullRequestOverview';
import {
  useAllDiffQuery,
  useDeleteCommentMutation,
  useGithubPullRequestChecksQuery,
  useGithubPullRequestDetailQuery,
  useUpdateCommentMutation,
} from '../query/hooks';
import { queryKeys } from '../query/keys';
import type { FileDiff, GithubCheckRun, GithubPullRequestDetail, GithubReviewEvent, ReviewComment } from '@shared/types';

type PrTab = 'activity' | 'diff';
const EMPTY_DIFFS: FileDiff[] = [];
const EMPTY_CHECKS: GithubCheckRun[] = [];

export default function PullRequestDetailView() {
  const { state, dispatch, toast } = useApp();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [tab, setTab] = useState<PrTab>('activity');
  const [composer, setComposer] = useState<null | {
    target: 'line' | 'hunk' | 'file';
    side: 'old' | 'new' | 'none';
    line: number | null;
    hunkHeader: string | null;
    filePath: string;
  }>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const repo = state.repo;
  const prNumber = state.prNumber;
  const detailQuery = useGithubPullRequestDetailQuery(repo?.id ?? null, prNumber);
  const detail = detailQuery.data ?? null;
  const diffsQuery = useAllDiffQuery(
    repo?.id ?? null,
    {
      base: detail ? `origin/${detail.baseRef}` : undefined,
      head: detail?.headSha,
    },
    !!detail,
  );
  const checksQuery = useGithubPullRequestChecksQuery(repo?.id ?? null, detail?.headSha);
  const diffs = diffsQuery.data ?? EMPTY_DIFFS;
  const checks = checksQuery.data ?? EMPTY_CHECKS;
  const loading = detailQuery.isLoading || diffsQuery.isFetching || checksQuery.isFetching;
  const loadError =
    detailQuery.error instanceof Error
      ? detailQuery.error.message
      : diffsQuery.error instanceof Error
      ? diffsQuery.error.message
      : checksQuery.error instanceof Error
      ? checksQuery.error.message
      : null;

  useEffect(() => {
    if (loadError) toast('error', loadError);
  }, [loadError, toast]);

  useEffect(() => {
    // Don't disturb the current selection while a refetch is in flight (a new
    // query key — e.g. the author pushed a new headSha — briefly yields an empty
    // diff list before the data arrives). Only re-anchor once the diff list has
    // actually loaded.
    if (diffsQuery.isPending) return;
    if (!diffs.length) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath((current) =>
      current && diffs.some((diff) => diff.filePath === current) ? current : diffs[0].filePath,
    );
  }, [diffs, diffsQuery.isPending]);

  const selectedDiff = useMemo(() => diffs.find((d) => d.filePath === selectedPath) ?? null, [diffs, selectedPath]);
  const selectedDiffPath = selectedDiff?.filePath ?? null;

  const onLineComment = useCallback(
    (side: 'old' | 'new', line: number, hunkHeader: string) => {
      if (selectedDiffPath) setComposer({ target: 'line', side, line, hunkHeader, filePath: selectedDiffPath });
    },
    [selectedDiffPath],
  );
  const onHunkComment = useCallback(
    (hunkHeader: string) => {
      if (selectedDiffPath)
        setComposer({ target: 'hunk', side: 'none', line: null, hunkHeader, filePath: selectedDiffPath });
    },
    [selectedDiffPath],
  );
  const onFileComment = useCallback(() => {
    if (selectedDiffPath)
      setComposer({ target: 'file', side: 'none', line: null, hunkHeader: null, filePath: selectedDiffPath });
  }, [selectedDiffPath]);

  if (!repo || !prNumber) {
    return <div className="p-6 text-text-muted">Open a review from the list.</div>;
  }

  if (!detail) {
    return <div className="p-6 text-text-muted">{loading ? 'Loading...' : 'No PR detail.'}</div>;
  }

  return (
    <>
      <ResizableLayout
        storageKey="pr-detail"
        className="h-full w-full min-h-0 bg-bg-panel"
        panes={[
          { defaultSize: 300, minSize: 240, maxSize: 520 },
          { defaultSize: 0, minSize: 360, flex: true },
          { defaultSize: 320, minSize: 280, maxSize: 460 },
        ]}
      >
        <aside className="overflow-auto border-r border-border bg-bg p-3.5">
          <button className="btn h-8 w-full mb-3" onClick={() => dispatch({ type: 'view', view: 'pr-list' })}>
            Back to reviews
          </button>

          <section className="panel-card p-3 mb-3.5">
            <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
              <GitPullRequest size={14} className="text-success" />
              PR #{detail.number}
            </div>
            <div className="text-sm font-semibold leading-tight mt-1.5">{detail.title}</div>
            <div className="text-xs text-text-muted mt-1.5 font-mono truncate">
              {detail.author} · {detail.headRef} to {detail.baseRef}
            </div>
          </section>

          <div className="section-label mb-2">Changed files</div>
          <div className="grid gap-[3px]">
            {diffs.map((d) => (
              <button
                key={d.filePath}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center gap-2 min-w-0 border',
                  selectedPath === d.filePath
                    ? 'bg-bg-panel border-border shadow-card'
                    : 'border-transparent hover:bg-bg-subtle',
                )}
                onClick={() => {
                  setSelectedPath(d.filePath);
                  setTab('diff');
                }}
              >
                <span className="font-mono text-xs truncate flex-1" title={d.filePath}>
                  {d.filePath}
                </span>
                {d.isNew && <span className="tag">new</span>}
                {d.isDeleted && <span className="tag">del</span>}
                {d.isRenamed && <span className="tag">ren</span>}
              </button>
            ))}
            {!diffs.length && (
              <div className="p-3 text-xs text-text-muted">
                No diff available. The PR head may have moved; try re-checking out.
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 grid grid-rows-[auto_minmax(0,1fr)] bg-bg-panel">
          <header className="border-b border-border bg-bg-panel px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
                  <CircleDot size={14} className={detail.state === 'open' ? 'text-success' : 'text-text-muted'} />
                  <span>{detail.state}</span>
                  <span>#{detail.number}</span>
                  <span>{detail.headRef} to {detail.baseRef}</span>
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight leading-tight">{detail.title}</h1>
              </div>
              <div className="flex items-center gap-2 flex-none">
                <button className="btn h-8 inline-flex items-center gap-1.5" onClick={() => void api.ghPrOpenInBrowser(repo.id, prNumber)}>
                  <ExternalLink size={14} />
                  GitHub
                </button>
                <button className="btn-primary h-8" onClick={() => setSubmitOpen(true)}>
                  Submit review
                </button>
              </div>
            </div>
            <div className="mt-3 inline-flex bg-bg border border-border rounded-lg p-[3px] gap-1">
              <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
                Activity
              </TabButton>
              <TabButton active={tab === 'diff'} onClick={() => setTab('diff')}>
                Diff
              </TabButton>
            </div>
          </header>

          {tab === 'activity' ? (
            <ActivityView detail={detail} diffs={diffs} checks={checks} loading={loading} />
          ) : selectedDiff ? (
            <PrFileDiff
              diff={selectedDiff}
              comments={state.comments}
              onLineComment={onLineComment}
              onHunkComment={onHunkComment}
              onFileComment={onFileComment}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted">Select a file.</div>
          )}
        </section>

        <PrSummaryPanel
          detail={detail}
          diffs={diffs}
          checks={checks}
          commentCount={state.comments.length}
          onSubmit={() => setSubmitOpen(true)}
        />
      </ResizableLayout>

      {composer && state.session && (
        <CommentComposer
          filePath={composer.filePath}
          target={composer.target}
          side={composer.side}
          line={composer.line}
          hunkHeader={composer.hunkHeader}
          onClose={() => setComposer(null)}
        />
      )}
      {submitOpen && <SubmitReviewDialog detail={detail} onClose={() => setSubmitOpen(false)} />}
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'h-7 px-2.5 rounded-md text-xs font-medium',
        active ? 'bg-bg-panel text-text-primary border border-border' : 'text-text-muted hover:text-text-primary',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function lineCommentKey(side: 'old' | 'new', lineNumber: number): string {
  return `${side}:${lineNumber}`;
}

const PrFileDiff = React.memo(function PrFileDiff({
  diff,
  comments: allComments,
  onLineComment,
  onHunkComment,
  onFileComment,
}: {
  diff: FileDiff;
  comments: ReviewComment[];
  onLineComment: (side: 'old' | 'new', line: number, hunkHeader: string) => void;
  onHunkComment: (hunkHeader: string) => void;
  onFileComment: () => void;
}) {
  const comments = useMemo(
    () => allComments.filter((c) => c.file_path === diff.filePath),
    [allComments, diff.filePath],
  );
  // Index line comments by side:lineNumber so they can render inline beneath the
  // line they annotate (these were saved but previously never displayed here).
  const lineCommentMap = useMemo(() => {
    const out = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      if (c.target_kind !== 'line' || c.line_number == null) continue;
      if (c.diff_side !== 'old' && c.diff_side !== 'new') continue;
      const key = lineCommentKey(c.diff_side, c.line_number);
      const arr = out.get(key) ?? [];
      arr.push(c);
      out.set(key, arr);
    }
    return out;
  }, [comments]);
  const baseName = diff.filePath.split('/').pop() ?? diff.filePath;
  const dirName = diff.filePath.includes('/') ? diff.filePath.slice(0, diff.filePath.lastIndexOf('/')) : '';
  return (
    <section className="flex-1 min-h-0 overflow-auto bg-bg-panel grid grid-rows-[auto_1fr]">
      <header className="sticky top-0 z-10 grid grid-cols-[1fr_auto] gap-4 items-center px-4 py-3 bg-bg-panel border-b border-border">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight leading-tight truncate">{baseName}</h1>
          <p className="mt-0.5 text-xs text-text-muted font-mono truncate">
            {dirName && `${dirName}/`}
            {diff.isNew && <span className="ml-2 tag">new</span>}
            {diff.isDeleted && <span className="ml-2 tag">deleted</span>}
            {diff.isRenamed && <span className="ml-2 tag">renamed</span>}
            {diff.isBinary && <span className="ml-2 tag">binary</span>}
          </p>
        </div>
        <button className="btn h-8 inline-flex items-center gap-1.5" onClick={onFileComment}>
          <MessageSquare size={14} />
          Comment file
        </button>
      </header>
      <div className="px-4 pb-4 pt-3 grid gap-3.5">
        {diff.isBinary ? (
          <div className="panel-card p-6 text-sm text-text-muted">Binary file.</div>
        ) : diff.hunks.length === 0 ? (
          <div className="panel-card p-6 text-sm text-text-muted">No changes.</div>
        ) : (
          diff.hunks.map((h) => (
            <article key={h.header} className="panel-card">
              <div className="hunk-header">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono truncate">{h.header}</span>
                </div>
                <button className="btn-ghost h-7 text-xs px-2" onClick={() => onHunkComment(h.header)}>
                  Comment hunk
                </button>
              </div>
                {h.lines.map((l, idx) => {
                  const cls =
                    l.kind === 'add' ? 'add' : l.kind === 'del' ? 'del' : l.kind === 'meta' ? 'context italic text-text-muted' : 'context';
                  const side: 'old' | 'new' | null =
                    l.kind === 'del' ? 'old' : l.kind === 'add' ? 'new' : null;
                  const lineNumber = side === 'old' ? l.oldLineNumber : side === 'new' ? l.newLineNumber : null;
                  const inlineComments =
                    side && lineNumber != null ? lineCommentMap.get(lineCommentKey(side, lineNumber)) ?? [] : [];
                  return (
                    <React.Fragment key={idx}>
                      <div
                        className={cn('diff-line group', cls, inlineComments.length && 'has-comment')}
                        onDoubleClick={() => {
                          if (side && lineNumber != null) onLineComment(side, lineNumber, h.header);
                        }}
                      >
                        <div className="gut">{l.oldLineNumber ?? ''}</div>
                        <div className="gut">{l.newLineNumber ?? ''}</div>
                        <div className="body relative">
                          {l.content}
                          {side && lineNumber != null && (
                            <button
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 h-5 w-5 rounded-md border border-border bg-bg-panel grid place-items-center text-[10px] text-text-muted hover:text-accent"
                              onClick={() => onLineComment(side, lineNumber, h.header)}
                            >
                              +
                            </button>
                          )}
                        </div>
                      </div>
                      {inlineComments.map((c) => (
                        <PrInlineComment key={c.id} comment={c} kind="line" />
                      ))}
                    </React.Fragment>
                  );
                })}
                {comments
                  .filter((c) => c.target_kind === 'hunk' && c.hunk_header === h.header)
                  .map((c) => (
                    <PrInlineComment key={c.id} comment={c} kind="hunk" />
                  ))}
            </article>
          ))
        )}
        {comments
          .filter((c) => c.target_kind === 'file')
          .map((c) => (
            <PrInlineComment key={c.id} comment={c} kind="file" />
          ))}
      </div>
    </section>
  );
});

function PrInlineComment({ comment, kind }: { comment: ReviewComment; kind: 'line' | 'hunk' | 'file' }) {
  const { state, toast, logActivity } = useApp();
  const sessionId = state.session?.id ?? null;
  const updateComment = useUpdateCommentMutation(sessionId);
  const deleteComment = useDeleteCommentMutation(sessionId);
  const resolved = comment.status === 'resolved';

  const label =
    kind === 'line'
      ? `line ${comment.diff_side === 'old' ? '−' : '+'}${comment.line_number}`
      : kind === 'hunk'
      ? 'hunk'
      : 'file';

  const toggleResolve = async () => {
    try {
      await updateComment.mutateAsync({ id: comment.id, patch: { status: resolved ? 'open' : 'resolved' } });
      logActivity({
        kind: 'comment_resolved',
        message: resolved ? 'Reopened comment' : 'Resolved comment',
        detail: comment.file_path,
      });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const remove = async () => {
    try {
      await deleteComment.mutateAsync(comment.id);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const wrapperCls =
    kind === 'file'
      ? 'panel-card px-3 py-2.5 text-sm'
      : 'px-3 py-2.5 bg-bg-subtle text-sm border-t border-border';
  return (
    <div className={wrapperCls}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="small-mono">
          {label} · {formatDateTime(comment.created_at)}
          {comment.label && <span className="ml-1 chip">{comment.label}</span>}
          {resolved && <span className="ml-1 chip text-success border-success/30">resolved</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <button
            className="btn-ghost h-6 text-[11px] px-2"
            onClick={() => void toggleResolve()}
            disabled={updateComment.isPending}
          >
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button
            className="btn-ghost h-6 text-[11px] px-2 text-text-muted hover:text-danger"
            onClick={() => void remove()}
            disabled={deleteComment.isPending}
          >
            Delete
          </button>
        </span>
      </div>
      <div className="whitespace-pre-wrap break-words">{comment.body}</div>
    </div>
  );
}

function SubmitReviewDialog({
  detail,
  onClose,
}: {
  detail: GithubPullRequestDetail;
  onClose: () => void;
}) {
  const { state, toast } = useApp();
  const queryClient = useQueryClient();
  const sessionId = state.session?.id ?? null;
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<GithubReviewEvent>('COMMENT');
  const [selectedCommentIds, setSelectedCommentIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  // Once GitHub has accepted the review, a failed local-resolution step must NOT
  // re-post it. Remember which comment ids were already submitted so a retry only
  // re-runs the (idempotent) local resolve step.
  const submittedRef = React.useRef<number[] | null>(null);

  const lineComments = useMemo(
    () =>
      state.comments.filter(
        (c) =>
          c.target_kind === 'line' &&
          c.status === 'open' &&
          c.line_number != null &&
          (c.diff_side === 'old' || c.diff_side === 'new'),
      ),
    [state.comments],
  );
  const selectedLineComments = useMemo(
    () => lineComments.filter((c) => selectedCommentIds.includes(c.id)),
    [lineComments, selectedCommentIds],
  );
  const canSubmit = event === 'APPROVE' || body.trim().length > 0 || selectedLineComments.length > 0;

  useEffect(() => {
    setSelectedCommentIds((ids) => ids.filter((id) => lineComments.some((c) => c.id === id)));
  }, [lineComments]);

  const toggleComment = (id: number) => {
    setSelectedCommentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const submit = async () => {
    if (!state.repo) return;
    setBusy(true);
    try {
      // Step 1 — post the review to GitHub exactly once. If a previous attempt
      // already succeeded but the local resolve step failed, skip the re-post.
      if (submittedRef.current == null) {
        await api.ghPrSubmitReview(state.repo.id, {
          prNumber: detail.number,
          event,
          body,
          // Anchor the review to the head sha that was actually reviewed.
          commitId: detail.headSha,
          comments: selectedLineComments.map((c) => ({
            path: c.file_path,
            line: c.line_number ?? 1,
            side: c.diff_side === 'old' ? 'LEFT' : 'RIGHT',
            body: c.body,
          })),
        });
        submittedRef.current = selectedLineComments.map((c) => c.id);
      }
      // Step 2 — mark the submitted comments resolved locally. Don't let one
      // failed update abort the rest, and surface a partial failure to the user.
      const ids = submittedRef.current;
      const results = await Promise.allSettled(
        ids.map((id) => api.updateComment(id, { status: 'resolved' })),
      );
      if (sessionId != null) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.session.comments(sessionId) });
      }
      if (results.some((r) => r.status === 'rejected')) {
        toast('error', 'Review submitted, but some comments could not be marked resolved. Retry.');
        return;
      }
      toast('success', `Review submitted (${event})`);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
      <div className="panel-card p-4 w-[560px] shadow-raised">
        <div className="text-base font-semibold mb-1">Submit review · #{detail.number}</div>
        <div className="text-xs text-text-muted mb-3">
          {selectedLineComments.length} of {lineComments.length} local line comment
          {lineComments.length === 1 ? '' : 's'} selected for GitHub.
        </div>
        <textarea
          className="input min-h-[140px] font-sans"
          placeholder="Summary of your review (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <section className="mt-3 border border-border rounded-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-bg-subtle border-b border-border">
            <span className="text-xs font-semibold text-text-secondary">Line comments</span>
            <div className="flex items-center gap-1.5">
              <button
                className="btn-ghost h-7 text-[11px] px-2"
                onClick={() => setSelectedCommentIds(lineComments.map((c) => c.id))}
                disabled={!lineComments.length}
              >
                Select all
              </button>
              <button
                className="btn-ghost h-7 text-[11px] px-2"
                onClick={() => setSelectedCommentIds([])}
                disabled={!selectedCommentIds.length}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-[220px] overflow-auto">
            {lineComments.length === 0 ? (
              <div className="px-3 py-3 text-sm text-text-muted">No local line comments ready to submit.</div>
            ) : (
              lineComments.map((c) => (
                <label
                  key={c.id}
                  className="grid grid-cols-[auto_1fr] gap-2 px-3 py-2.5 border-b last:border-b-0 border-border cursor-pointer hover:bg-bg-subtle"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedCommentIds.includes(c.id)}
                    onChange={() => toggleComment(c.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-mono text-text-muted truncate">
                      {c.file_path} · {c.diff_side === 'old' ? '-' : '+'}
                      {c.line_number}
                      {c.label && <span className="ml-1 chip">{c.label}</span>}
                    </span>
                    <span className="block mt-1 text-sm whitespace-pre-wrap">{c.body}</span>
                  </span>
                </label>
              ))
            )}
          </div>
        </section>
        <div className="mt-3 flex items-center gap-3">
          {(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const).map((ev) => (
            <label key={ev} className="text-sm flex items-center gap-1 cursor-pointer">
              <input type="radio" name="ev" checked={event === ev} onChange={() => setEvent(ev)} />
              {ev === 'COMMENT' ? 'Comment' : ev === 'APPROVE' ? 'Approve' : 'Request changes'}
            </label>
          ))}
          <div className="flex-1" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void submit()} disabled={busy || !canSubmit}>
            Submit to GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
