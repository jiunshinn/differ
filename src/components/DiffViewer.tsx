import React, { useCallback, useMemo, useState } from 'react';
import { useApp, useAppStore } from '../state/AppStore';
import { cn } from '../utils/cn';
import { formatDateTime } from '../utils/date';
import CommentComposer from './CommentComposer';
import {
  useFileDiffQuery,
  useSetFileStateMutation,
  useStageHunkMutation,
  useUnstageHunkMutation,
  useUpdateCommentMutation,
} from '../query/hooks';
import type { DiffHunk, DiffLine, FileDiff, ReviewComment } from '@shared/types';

type Mode = 'unified' | 'split';

export default function DiffViewer() {
  const { state, dispatch, loadDiff, refresh, toast, logActivity } = useApp();
  const [composer, setComposer] = useState<null | {
    target: 'line' | 'hunk' | 'file';
    side: 'old' | 'new' | 'none';
    line: number | null;
    hunkHeader: string | null;
  }>(null);

  const selected = state.selectedFile;
  const repoId = state.repo?.id ?? null;
  const sessionId = state.session?.id ?? null;
  const ignoreWhitespace = state.ignoreWhitespace;
  const stageHunkMutation = useStageHunkMutation(repoId, selected);
  const unstageHunkMutation = useUnstageHunkMutation(repoId, selected);
  const setFileStateMutation = useSetFileStateMutation(sessionId);
  // Shares the same query key as the diff observer inside useApp, so this reads
  // the same cache entry (no extra fetch) and surfaces its error state — which
  // the diffsByFile map never exposes (it only carries data).
  const diffQuery = useFileDiffQuery({
    repoId,
    filePath: selected,
    staged: state.diffStaged,
    ignoreWhitespace: state.ignoreWhitespace,
    includeUntracked: !state.diffStaged,
  });

  // Stabilized so memoized hunk rows don't re-render when an unrelated store
  // slice (file filter, toast, activity) changes. hunkHeader is passed as an
  // argument rather than closed over, keeping these identities constant.
  const stageHunk = useCallback(
    async (hunkHeader: string) => {
      try {
        await stageHunkMutation.mutateAsync({ hunkHeader, opts: { ignoreWhitespace } });
        logActivity({ kind: 'file_staged', message: 'Staged hunk', detail: `${selected} ${hunkHeader}` });
        await refresh();
      } catch (e) {
        toast('error', (e as Error).message);
      }
    },
    [stageHunkMutation, ignoreWhitespace, logActivity, selected, refresh, toast],
  );
  const unstageHunk = useCallback(
    async (hunkHeader: string) => {
      try {
        await unstageHunkMutation.mutateAsync({ hunkHeader, opts: { ignoreWhitespace } });
        logActivity({ kind: 'file_unstaged', message: 'Unstaged hunk', detail: `${selected} ${hunkHeader}` });
        await refresh();
      } catch (e) {
        toast('error', (e as Error).message);
      }
    },
    [unstageHunkMutation, ignoreWhitespace, logActivity, selected, refresh, toast],
  );

  const addLineComment = useCallback(
    (hunkHeader: string, side: 'old' | 'new', lineNumber: number) =>
      setComposer({ target: 'line', side, line: lineNumber, hunkHeader }),
    [],
  );
  const addHunkComment = useCallback(
    (hunkHeader: string) => setComposer({ target: 'hunk', side: 'none', line: null, hunkHeader }),
    [],
  );

  const toggleReviewed = useCallback(async () => {
    if (!sessionId || !selected) return;
    const current = state.fileStates.find((fs) => fs.file_path === selected);
    const next = current?.status === 'reviewed' ? 'viewed' : 'reviewed';
    try {
      await setFileStateMutation.mutateAsync({ filePath: selected, status: next });
      if (next === 'reviewed') {
        logActivity({ kind: 'file_reviewed', message: 'Marked reviewed', detail: selected });
      }
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }, [sessionId, selected, state.fileStates, setFileStateMutation, logActivity, toast]);

  // Memoized so the [comments] dependency of the per-hunk comment maps is
  // referentially stable across unrelated re-renders.
  const fileComments = useMemo(
    () => state.comments.filter((c) => c.file_path === selected),
    [state.comments, selected],
  );

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Select a file to view its diff.
      </div>
    );
  }
  const diffEntry = state.diffsByFile[selected];
  if (diffEntry === undefined) {
    if (diffQuery.isError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-muted text-sm px-6 text-center">
          <p className="font-medium text-text-primary">Couldn’t load diff</p>
          <p className="font-mono text-xs truncate max-w-full">{selected}</p>
          <p className="text-xs max-w-[60ch] break-words">{(diffQuery.error as Error)?.message ?? 'Unknown error'}</p>
          <button className="btn h-8 mt-1" onClick={() => void loadDiff(selected)}>
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading diff…
      </div>
    );
  }
  if (diffEntry === null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1 text-text-muted text-sm px-6 text-center">
        <p className="font-medium text-text-primary">No changes to show</p>
        <p className="font-mono text-xs truncate max-w-full">{selected}</p>
        <p className="text-xs">
          This file matches {state.diffStaged ? 'the index' : 'HEAD'} — nothing to diff.
        </p>
      </div>
    );
  }
  const diff = diffEntry;

  const openComments = fileComments.filter((c) => c.status === 'open').length;

  const setMode = (m: Mode) => dispatch({ type: 'setDiffMode', mode: m });

  const isReviewed = state.fileStates.find((fs) => fs.file_path === selected)?.status === 'reviewed';

  let added = 0;
  let removed = 0;
  for (const h of diff.hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') added++;
      else if (l.kind === 'del') removed++;
    }
  }
  const baseName = selected.split('/').pop() ?? selected;
  const dirName = selected.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '';

  return (
    <section className="diff-area min-w-0 min-h-0 overflow-auto bg-bg-panel grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr]">
      <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto] gap-4 items-center px-4 py-3 bg-bg-panel border-b border-border">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight leading-tight truncate">{baseName}</h1>
          <p className="mt-0.5 text-xs text-text-muted font-mono truncate">
            {dirName && `${dirName}/`}
            {diff.oldPath && diff.oldPath !== diff.filePath && (
              <span className="text-text-muted">{diff.oldPath} → </span>
            )}
            {state.diffStaged && <span className="ml-2 tag">staged</span>}
            {diff.isNew && <span className="ml-2 tag">new</span>}
            {diff.isDeleted && <span className="ml-2 tag">deleted</span>}
            {diff.isRenamed && <span className="ml-2 tag">renamed</span>}
            {diff.isBinary && <span className="ml-2 tag">binary</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            value={state.diffMode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { label: 'Unified', value: 'unified' },
              { label: 'Split', value: 'split' },
            ]}
          />
          <button
            className={cn('btn h-8', state.ignoreWhitespace && 'text-accent border-accent')}
            onClick={() => {
              dispatch({ type: 'setIgnoreWhitespace', value: !state.ignoreWhitespace });
              void loadDiff(selected);
            }}
            title="Toggle whitespace"
          >
            WS
          </button>
          <button
            className="btn h-8"
            onClick={() => setComposer({ target: 'file', side: 'none', line: null, hunkHeader: null })}
          >
            Comment file
          </button>
          <button
            className={cn('btn h-8', isReviewed && 'bg-success/10 border-success text-success')}
            onClick={() => void toggleReviewed()}
          >
            {isReviewed ? 'Reviewed ✓' : 'Mark reviewed'}
          </button>
          <button
            className={cn('btn h-8', state.diffFullscreen && 'text-accent border-accent')}
            onClick={() => dispatch({ type: 'setDiffFullscreen', value: !state.diffFullscreen })}
            title={state.diffFullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={state.diffFullscreen ? 'Exit full screen' : 'Enter full screen'}
          >
            {state.diffFullscreen ? '⤡' : '⤢'}
          </button>
        </div>
      </div>

      <div className="px-4 pt-3.5 pb-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <SummaryTile value={`+${added}`} label="Added lines" tone="success" />
        <SummaryTile value={`−${removed}`} label="Removed lines" tone="danger" />
        <SummaryTile value={openComments} label="Open comments" tone={openComments ? 'warn' : 'neutral'} />
        <SummaryTile value={diff.hunks.length} label="Hunks" tone="neutral" />
      </div>

      <div className="px-4 pb-4 grid grid-cols-[minmax(0,1fr)] gap-3.5">
        {diff.isBinary ? (
          <div className="panel-card p-6 text-sm text-text-muted">Binary file — diff not shown.</div>
        ) : diff.hunks.length === 0 ? (
          <div className="panel-card p-6 text-sm text-text-muted">No textual changes.</div>
        ) : (
          diff.hunks.map((h) => (
            <HunkBlock
              key={h.header}
              file={diff}
              hunk={h}
              mode={state.diffMode}
              comments={fileComments}
              staged={state.diffStaged}
              sessionId={sessionId}
              onStage={stageHunk}
              onUnstage={unstageHunk}
              onAddLineComment={addLineComment}
              onAddHunkComment={addHunkComment}
            />
          ))
        )}
      </div>

      {composer && sessionId && (
        <CommentComposer
          filePath={selected}
          target={composer.target}
          side={composer.side}
          line={composer.line}
          hunkHeader={composer.hunkHeader}
          onClose={() => setComposer(null)}
        />
      )}
    </section>
  );
}

function SummaryTile({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone: 'success' | 'danger' | 'warn' | 'accent' | 'neutral';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'danger'
      ? 'text-danger'
      : tone === 'warn'
      ? 'text-warn'
      : tone === 'accent'
      ? 'text-accent'
      : 'text-text-primary';
  return (
    <div className="panel-card p-3">
      <div className={cn('font-mono text-xl leading-tight tabular-nums', toneClass)}>{value}</div>
      <div className="mt-1 text-xs text-text-muted">{label}</div>
    </div>
  );
}

function ToggleGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <div className="inline-flex bg-bg border border-border rounded-lg p-[3px] gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          className={cn(
            'min-h-[28px] px-2.5 rounded-md text-xs font-medium',
            value === o.value
              ? 'bg-bg-panel text-text-primary border border-border'
              : 'text-text-muted hover:text-text-primary',
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const HunkBlock = React.memo(function HunkBlock({
  file,
  hunk,
  mode,
  comments,
  staged,
  sessionId,
  onStage,
  onUnstage,
  onAddLineComment,
  onAddHunkComment,
}: {
  file: FileDiff;
  hunk: DiffHunk;
  mode: Mode;
  comments: ReviewComment[];
  staged: boolean;
  sessionId: number | null;
  onStage: (hunkHeader: string) => void;
  onUnstage: (hunkHeader: string) => void;
  onAddLineComment: (hunkHeader: string, side: 'old' | 'new', lineNumber: number) => void;
  onAddHunkComment: (hunkHeader: string) => void;
}) {
  const header = hunk.header;
  const hunkComments = useMemo(
    () => comments.filter((c) => c.target_kind === 'hunk' && c.hunk_header === header),
    [comments, header],
  );
  // Bind the hunk header so child rows receive stable callbacks that don't
  // depend on which hunk they belong to.
  const stage = useCallback(() => onStage(header), [onStage, header]);
  const unstage = useCallback(() => onUnstage(header), [onUnstage, header]);
  const addHunkComment = useCallback(() => onAddHunkComment(header), [onAddHunkComment, header]);
  const addLineComment = useCallback(
    (side: 'old' | 'new', lineNumber: number) => onAddLineComment(header, side, lineNumber),
    [onAddLineComment, header],
  );
  return (
    <article className="panel-card">
      <div className="hunk-header">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono truncate">{header}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost text-xs h-7 px-2" onClick={addHunkComment}>
            Comment hunk
          </button>
          {staged ? (
            <button className="btn-ghost text-xs h-7 px-2" onClick={unstage}>
              Unstage
            </button>
          ) : (
            <button className="btn-ghost text-xs h-7 px-2" onClick={stage}>
              Stage
            </button>
          )}
        </div>
      </div>
      {mode === 'unified' ? (
        <UnifiedHunk
          file={file}
          hunk={hunk}
          comments={comments}
          sessionId={sessionId}
          onAddLineComment={addLineComment}
        />
      ) : (
        <SplitHunk
          file={file}
          hunk={hunk}
          comments={comments}
          sessionId={sessionId}
          onAddLineComment={addLineComment}
        />
      )}
      {hunkComments.map((c) => (
        <InlineCommentRow key={c.id} comment={c} indent="hunk" sessionId={sessionId} />
      ))}
    </article>
  );
});

function lineKey(side: 'old' | 'new', lineNumber: number | null): string {
  return `${side}:${lineNumber ?? 'x'}`;
}

function commentsByLine(comments: ReviewComment[]): Map<string, ReviewComment[]> {
  const out = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    if (c.target_kind !== 'line' || c.line_number == null) continue;
    const key = lineKey(c.diff_side as 'old' | 'new', c.line_number);
    const arr = out.get(key) ?? [];
    arr.push(c);
    out.set(key, arr);
  }
  return out;
}

function UnifiedHunk({
  hunk,
  comments,
  sessionId,
  onAddLineComment,
}: {
  file: FileDiff;
  hunk: DiffHunk;
  comments: ReviewComment[];
  sessionId: number | null;
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  const lineCommentMap = useMemo(() => commentsByLine(comments), [comments]);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {hunk.lines.map((l, idx) => (
          <UnifiedRow
            key={idx}
            line={l}
            lineCommentMap={lineCommentMap}
            sessionId={sessionId}
            onAddLineComment={onAddLineComment}
          />
        ))}
      </div>
    </div>
  );
}

const UnifiedRow = React.memo(function UnifiedRow({
  line,
  lineCommentMap,
  sessionId,
  onAddLineComment,
}: {
  line: DiffLine;
  lineCommentMap: Map<string, ReviewComment[]>;
  sessionId: number | null;
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  const cls =
    line.kind === 'add' ? 'add' : line.kind === 'del' ? 'del' : line.kind === 'meta' ? 'context italic text-text-muted' : 'context';
  const side: 'old' | 'new' | null =
    line.kind === 'del'
      ? 'old'
      : line.kind === 'add'
      ? 'new'
      : line.newLineNumber != null
      ? 'new'
      : line.oldLineNumber != null
      ? 'old'
      : null;
  const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
  // Context lines exist on both sides; a comment anchored to the old side (made
  // in split mode) must still surface here, so look up both keys.
  const inlineComments = useMemo(() => {
    const matches: ReviewComment[] = [];
    if (line.oldLineNumber != null) matches.push(...(lineCommentMap.get(lineKey('old', line.oldLineNumber)) ?? []));
    if (line.newLineNumber != null) matches.push(...(lineCommentMap.get(lineKey('new', line.newLineNumber)) ?? []));
    return matches;
  }, [lineCommentMap, line.oldLineNumber, line.newLineNumber]);
  return (
    <>
      <div
        className={cn('diff-line group', cls, inlineComments.length && 'has-comment')}
        onDoubleClick={() => {
          if (side && lineNumber != null) onAddLineComment(side, lineNumber);
        }}
      >
        <div className="gut">{line.oldLineNumber ?? ''}</div>
        <div className="gut">{line.newLineNumber ?? ''}</div>
        <div className="body relative">
          {line.content}
          {side && lineNumber != null && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 h-5 w-5 rounded-md border border-border bg-bg-panel grid place-items-center text-[10px] text-text-muted hover:text-accent"
              onClick={() => onAddLineComment(side, lineNumber)}
              title="Comment line (or double-click)"
            >
              +
            </button>
          )}
        </div>
      </div>
      {inlineComments.map((c) => (
        <InlineCommentRow key={c.id} comment={c} indent="line" sessionId={sessionId} />
      ))}
    </>
  );
});

type Row = { left: DiffLine | null; right: DiffLine | null };

function buildSplitRows(lines: DiffLine[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === 'context') {
      rows.push({ left: l, right: l });
      i++;
    } else if (l.kind === 'del') {
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === 'del') {
        dels.push(lines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === 'add') {
        adds.push(lines[i]);
        i++;
      }
      const max = Math.max(dels.length, adds.length);
      for (let k = 0; k < max; k++) {
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
    } else if (l.kind === 'add') {
      rows.push({ left: null, right: l });
      i++;
    } else {
      rows.push({ left: l, right: l });
      i++;
    }
  }
  return rows;
}

function SplitHunk({
  hunk,
  comments,
  sessionId,
  onAddLineComment,
}: {
  file: FileDiff;
  hunk: DiffHunk;
  comments: ReviewComment[];
  sessionId: number | null;
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  const rows = useMemo(() => buildSplitRows(hunk.lines), [hunk.lines]);
  const lineCommentMap = useMemo(() => commentsByLine(comments), [comments]);

  return (
    <div className="grid grid-cols-2 divide-x divide-border">
      <div className="overflow-x-auto min-w-0">
        <div className="min-w-max">
          {rows.map((r, idx) => (
            <SideCell
              key={`l${idx}`}
              line={r.left}
              side="old"
              lineCommentMap={lineCommentMap}
              sessionId={sessionId}
              onAddLineComment={onAddLineComment}
            />
          ))}
        </div>
      </div>
      <div className="overflow-x-auto min-w-0">
        <div className="min-w-max">
          {rows.map((r, idx) => (
            <SideCell
              key={`r${idx}`}
              line={r.right}
              side="new"
              lineCommentMap={lineCommentMap}
              sessionId={sessionId}
              onAddLineComment={onAddLineComment}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const SideCell = React.memo(function SideCell({
  line,
  side,
  lineCommentMap,
  sessionId,
  onAddLineComment,
}: {
  line: DiffLine | null;
  side: 'old' | 'new';
  lineCommentMap: Map<string, ReviewComment[]>;
  sessionId: number | null;
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  if (!line) {
    return (
      <div className="diff-line split empty">
        <div className="gut" />
        <div className="body" />
      </div>
    );
  }
  const cls =
    line.kind === 'add' && side === 'new'
      ? 'add'
      : line.kind === 'del' && side === 'old'
      ? 'del'
      : line.kind === 'meta'
      ? 'context italic text-text-muted'
      : 'context';
  const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
  const key = lineNumber != null ? lineKey(side, lineNumber) : null;
  const inlineComments = key ? lineCommentMap.get(key) ?? [] : [];
  return (
    <>
      <div
        className={cn('diff-line split group', cls, inlineComments.length && 'has-comment')}
        onDoubleClick={() => {
          if (lineNumber != null) onAddLineComment(side, lineNumber);
        }}
      >
        <div className="gut">{lineNumber ?? ''}</div>
        <div className="body relative">
          {line.content}
          {lineNumber != null && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 h-5 w-5 rounded-md border border-border bg-bg-panel grid place-items-center text-[10px] text-text-muted hover:text-accent"
              onClick={() => onAddLineComment(side, lineNumber)}
            >
              +
            </button>
          )}
        </div>
      </div>
      {inlineComments.map((c) => (
        <InlineCommentRow key={c.id} comment={c} indent="line" sessionId={sessionId} />
      ))}
    </>
  );
});

const InlineCommentRow = React.memo(function InlineCommentRow({
  comment,
  indent,
  sessionId,
}: {
  comment: ReviewComment;
  indent: 'line' | 'hunk';
  sessionId: number | null;
}) {
  // Read only the narrow store actions this row needs instead of the heavy
  // useApp() hook (which subscribes to the whole store and mounts query
  // observers) once per comment row.
  const showToast = useAppStore((s) => s.showToast);
  const pushActivity = useAppStore((s) => s.pushActivity);
  const updateComment = useUpdateCommentMutation(sessionId);

  const resolve = async () => {
    try {
      await updateComment.mutateAsync({
        id: comment.id,
        patch: { status: comment.status === 'open' ? 'resolved' : 'open' },
      });
      pushActivity({
        kind: 'comment_resolved',
        message: comment.status === 'open' ? 'Resolved comment' : 'Reopened comment',
        detail: comment.file_path,
      });
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  return (
    <div
      className={cn(
        'grid grid-cols-[104px_1fr] border-b border-border bg-bg-panel',
        indent === 'hunk' && 'grid-cols-[44px_1fr]',
      )}
    >
      <div className="border-r border-border bg-bg-subtle" />
      <article className="m-2.5 border border-accent rounded-card overflow-hidden bg-bg-panel">
        <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="w-6 h-6 rounded-full bg-text-primary text-bg-panel grid place-items-center font-mono text-[11px]">
              {(comment.label?.slice(0, 2) ?? 'YO').toUpperCase()}
            </span>
            <span>
              {comment.target_kind === 'line'
                ? `Line ${comment.diff_side === 'old' ? '−' : '+'}${comment.line_number}`
                : comment.target_kind === 'hunk'
                ? 'Hunk note'
                : 'File note'}
            </span>
            {comment.label && <span className="chip">{comment.label}</span>}
          </div>
          <span className="small-mono">
            {comment.status === 'resolved' ? 'resolved' : 'pending review'} ·{' '}
            {formatDateTime(comment.created_at)}
          </span>
        </header>
        <div className="px-3 py-3">
          <p className="m-0 whitespace-pre-wrap max-w-[72ch]">{comment.body}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button className="btn h-8" onClick={() => void resolve()}>
              {comment.status === 'open' ? 'Resolve' : 'Reopen'}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
});
