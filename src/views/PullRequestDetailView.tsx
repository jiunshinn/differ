import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import CommentComposer from '../components/CommentComposer';
import ReviewPanel from '../components/ReviewPanel';
import LeftRail from '../components/LeftRail';
import ResizableLayout from '../components/ResizableLayout';
import type { FileDiff, GithubPullRequestDetail, GithubReviewEvent } from '@shared/types';

export default function PullRequestDetailView() {
  const { state, dispatch, toast, logActivity } = useApp();
  const [detail, setDetail] = useState<GithubPullRequestDetail | null>(null);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (!repo || !prNumber) return;
    void (async () => {
      setLoading(true);
      try {
        const d = await api.ghPrDetail(repo.id, prNumber);
        setDetail(d);
        const merged = await api.allDiff(repo.id, {
          base: `origin/${d.baseRef}`,
          head: d.headSha,
        });
        setDiffs(merged);
        if (merged.length && !selectedPath) setSelectedPath(merged[0].filePath);
      } catch (e) {
        toast('error', (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.id, prNumber]);

  if (!repo || !prNumber) {
    return <div className="p-6 text-text-muted">Open a pull request from the list.</div>;
  }

  const selectedDiff = useMemo(() => diffs.find((d) => d.filePath === selectedPath) ?? null, [diffs, selectedPath]);

  if (!detail) {
    return <div className="p-6 text-text-muted">{loading ? 'Loading…' : 'No PR detail.'}</div>;
  }

  return (
    <ResizableLayout
      storageKey="pr-detail"
      className="h-full w-full min-h-0 bg-bg-panel"
      panes={[
        { defaultSize: 220, minSize: 180, maxSize: 360 },
        { defaultSize: 260, minSize: 200, maxSize: 480 },
        { defaultSize: 0, minSize: 320, flex: true },
        { defaultSize: 360, minSize: 280, maxSize: 600 },
      ]}
    >
      <LeftRail />
      <aside className="overflow-auto border-r border-border bg-bg p-3.5">
        <section className="panel-card p-3 mb-3.5">
          <div className="text-xs text-text-muted font-mono">PR</div>
          <div className="text-sm font-semibold leading-tight mt-1">
            #{detail.number} {detail.title}
          </div>
          <div className="text-xs text-text-muted mt-1.5 font-mono">
            {detail.author} · {detail.headRef} → {detail.baseRef}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn" onClick={() => dispatch({ type: 'view', view: 'pr-list' })}>
              Back
            </button>
            <button className="btn-primary" onClick={() => setSubmitOpen(true)}>
              Submit
            </button>
          </div>
          <button
            className="btn w-full mt-2"
            onClick={() => void api.ghPrOpenInBrowser(repo.id, prNumber)}
          >
            Open on GitHub ↗
          </button>
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
              onClick={() => setSelectedPath(d.filePath)}
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
      <div className="min-h-0 flex flex-col">
        {selectedDiff ? (
          <PrFileDiff
            diff={selectedDiff}
            onLineComment={(side, line, hunkHeader) =>
              setComposer({ target: 'line', side, line, hunkHeader, filePath: selectedDiff.filePath })
            }
            onHunkComment={(hunkHeader) =>
              setComposer({ target: 'hunk', side: 'none', line: null, hunkHeader, filePath: selectedDiff.filePath })
            }
            onFileComment={() =>
              setComposer({ target: 'file', side: 'none', line: null, hunkHeader: null, filePath: selectedDiff.filePath })
            }
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted">Select a file.</div>
        )}
      </div>
      <ReviewPanel />
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
    </ResizableLayout>
  );
}

function PrFileDiff({
  diff,
  onLineComment,
  onHunkComment,
  onFileComment,
}: {
  diff: FileDiff;
  onLineComment: (side: 'old' | 'new', line: number, hunkHeader: string) => void;
  onHunkComment: (hunkHeader: string) => void;
  onFileComment: () => void;
}) {
  const { state, dispatch } = useApp();
  const comments = state.comments.filter((c) => c.file_path === diff.filePath);
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
        <button className="btn h-8" onClick={onFileComment}>
          Comment file
        </button>
      </header>
      <div className="px-4 pb-4 pt-3 grid gap-3.5">
        {diff.isBinary ? (
          <div className="panel-card p-6 text-sm text-text-muted">Binary file.</div>
        ) : diff.hunks.length === 0 ? (
          <div className="panel-card p-6 text-sm text-text-muted">No changes.</div>
        ) : (
          diff.hunks.map((h) => {
            const key = `${diff.filePath}::${h.header}`;
            const selected = state.selectedHunkKeys.includes(key);
            return (
              <article key={h.header} className="panel-card">
                <div className="hunk-header">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => dispatch({ type: 'toggleHunkSelection', key })}
                    />
                    <span className="font-mono truncate">{h.header}</span>
                  </label>
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
                  return (
                    <div
                      key={idx}
                      className={cn('diff-line group', cls)}
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
                  );
                })}
                {comments
                  .filter((c) => c.target_kind === 'hunk' && c.hunk_header === h.header)
                  .map((c) => (
                    <div key={c.id} className="px-3 py-2 bg-bg-subtle text-sm border-t border-border">
                      <div className="small-mono mb-1">
                        hunk · {new Date(c.created_at).toLocaleString()}
                      </div>
                      {c.body}
                    </div>
                  ))}
              </article>
            );
          })
        )}
        {comments
          .filter((c) => c.target_kind === 'file')
          .map((c) => (
            <div key={c.id} className="panel-card px-3 py-3 text-sm">
              <div className="small-mono mb-1">file · {new Date(c.created_at).toLocaleString()}</div>
              {c.body}
            </div>
          ))}
      </div>
    </section>
  );
}

function SubmitReviewDialog({
  detail,
  onClose,
}: {
  detail: GithubPullRequestDetail;
  onClose: () => void;
}) {
  const { state, toast, loadComments } = useApp();
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<GithubReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(false);

  const lineComments = useMemo(
    () => state.comments.filter((c) => c.target_kind === 'line' && c.status === 'open'),
    [state.comments],
  );

  const submit = async () => {
    if (!state.repo) return;
    setBusy(true);
    try {
      await api.ghPrSubmitReview(state.repo.id, {
        prNumber: detail.number,
        event,
        body,
        comments: lineComments.map((c) => ({
          path: c.file_path,
          line: c.line_number ?? 1,
          side: c.diff_side === 'old' ? 'LEFT' : 'RIGHT',
          body: c.body,
        })),
      });
      for (const c of lineComments) {
        await api.updateComment(c.id, { status: 'resolved' });
      }
      await loadComments();
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
          {lineComments.length} pending line comment{lineComments.length === 1 ? '' : 's'} will be sent.
        </div>
        <textarea
          className="input min-h-[140px] font-sans"
          placeholder="Summary of your review (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
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
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
