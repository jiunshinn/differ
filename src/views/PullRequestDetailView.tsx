import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import CommentComposer from '../components/CommentComposer';
import RightPanel from '../components/RightPanel';
import type { FileDiff, GithubPullRequestDetail, GithubReviewEvent } from '@shared/types';

export default function PullRequestDetailView() {
  const { state, dispatch, toast } = useApp();
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
        // Build the diff base..head. The PR ref is already fetched into the local repo by checkout.
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
  if (!detail) {
    return <div className="p-6 text-text-muted">{loading ? 'Loading…' : 'No PR detail.'}</div>;
  }

  const selectedDiff = useMemo(() => diffs.find((d) => d.filePath === selectedPath) ?? null, [diffs, selectedPath]);

  return (
    <div className="h-full flex">
      <div className="w-72 min-w-[240px] border-r border-border bg-bg-panel flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="text-xs text-text-muted">PR</div>
          <div className="text-sm font-semibold leading-tight">
            #{detail.number} {detail.title}
          </div>
          <div className="text-xs text-text-muted mt-1">
            {detail.author} · {detail.headRef} → {detail.baseRef}
          </div>
          <div className="mt-2 flex gap-1">
            <button className="btn-primary text-xs" onClick={() => setSubmitOpen(true)}>
              Submit review…
            </button>
            <button className="btn text-xs" onClick={() => void api.ghPrOpenInBrowser(repo.id, prNumber)}>
              Open ↗
            </button>
            <button className="btn text-xs" onClick={() => dispatch({ type: 'view', view: 'pr-list' })}>
              Back
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {diffs.map((d) => (
            <button
              key={d.filePath}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2',
                selectedPath === d.filePath ? 'bg-bg-hover' : 'hover:bg-bg-subtle',
              )}
              onClick={() => setSelectedPath(d.filePath)}
            >
              <span className="font-mono text-xs truncate flex-1">{d.filePath}</span>
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
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
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
      <div className="w-[360px] min-w-[300px] border-l border-border bg-bg-panel">
        <RightPanel />
      </div>
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
    </div>
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
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-9 px-3 flex items-center gap-2 border-b border-border">
        <div className="font-mono text-xs truncate flex-1">{diff.filePath}</div>
        <button className="btn" onClick={onFileComment}>
          Comment file
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {diff.isBinary ? (
          <div className="p-6 text-text-muted text-sm">Binary file.</div>
        ) : diff.hunks.length === 0 ? (
          <div className="p-6 text-text-muted text-sm">No changes.</div>
        ) : (
          diff.hunks.map((h) => {
            const key = `${diff.filePath}::${h.header}`;
            const selected = state.selectedHunkKeys.includes(key);
            return (
              <div key={h.header} className="border-b border-border-subtle">
                <div className="hunk-header">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => dispatch({ type: 'toggleHunkSelection', key })}
                    />
                    <span className="font-mono">{h.header}</span>
                  </label>
                  <button className="btn-ghost text-xs py-0" onClick={() => onHunkComment(h.header)}>
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
                            className="absolute right-1 top-0 opacity-0 group-hover:opacity-100 btn-ghost py-0 px-1 text-[10px]"
                            onClick={() => onLineComment(side, lineNumber, h.header)}
                          >
                            💬
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {comments
                  .filter((c) => c.target_kind === 'hunk' && c.hunk_header === h.header)
                  .map((c) => (
                    <div key={c.id} className="px-12 py-2 bg-bg-subtle text-sm border-y border-border-subtle">
                      <div className="text-xs text-text-muted">
                        hunk · {new Date(c.created_at).toLocaleString()}
                      </div>
                      {c.body}
                    </div>
                  ))}
              </div>
            );
          })
        )}
        {comments
          .filter((c) => c.target_kind === 'file')
          .map((c) => (
            <div key={c.id} className="px-6 py-3 bg-bg-subtle text-sm border-y border-border-subtle">
              <div className="text-xs text-text-muted">file · {new Date(c.created_at).toLocaleString()}</div>
              {c.body}
            </div>
          ))}
      </div>
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
      // Mark sent comments as resolved.
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="panel p-4 w-[560px]">
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
