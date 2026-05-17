import React, { useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import CommentComposer from './CommentComposer';
import type { DiffHunk, DiffLine, FileDiff, ReviewComment } from '@shared/types';

type Mode = 'unified' | 'split';

export default function DiffViewer() {
  const { state, dispatch, loadDiff, refresh, toast } = useApp();
  const [composer, setComposer] = useState<null | {
    target: 'line' | 'hunk' | 'file';
    side: 'old' | 'new' | 'none';
    line: number | null;
    hunkHeader: string | null;
  }>(null);

  const selected = state.selectedFile;
  const diff = selected ? state.diffsByFile[selected] : null;

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        Select a file to view its diff.
      </div>
    );
  }
  if (!diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        Loading diff…
      </div>
    );
  }

  const fileComments = state.comments.filter((c) => c.file_path === selected);

  const repoId = state.repo!.id;
  const sessionId = state.session?.id;

  const setMode = (m: Mode) => dispatch({ type: 'setDiffMode', mode: m });

  const stageHunk = async (hunkHeader: string) => {
    try {
      await api.stageHunk(repoId, selected, hunkHeader);
      await refresh();
      await loadDiff(selected);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const unstageHunk = async (hunkHeader: string) => {
    try {
      await api.unstageHunk(repoId, selected, hunkHeader);
      await refresh();
      await loadDiff(selected);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const toggleReviewed = async () => {
    if (!sessionId) return;
    const current = state.fileStates.find((fs) => fs.file_path === selected);
    const next = current?.status === 'reviewed' ? 'viewed' : 'reviewed';
    await api.setFileState(sessionId, selected, next);
    const states = await api.getFileStates(sessionId);
    dispatch({ type: 'setFileStates', states });
  };

  const isReviewed = state.fileStates.find((fs) => fs.file_path === selected)?.status === 'reviewed';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-9 px-3 flex items-center gap-2 border-b border-border bg-bg-panel">
        <div className="font-mono text-xs text-text-secondary truncate flex-1">
          {diff.oldPath && diff.oldPath !== diff.filePath && (
            <span className="text-text-muted">{diff.oldPath} → </span>
          )}
          {diff.filePath}
          {state.diffStaged && <span className="ml-2 tag">staged</span>}
          {diff.isNew && <span className="ml-2 tag">new</span>}
          {diff.isDeleted && <span className="ml-2 tag">deleted</span>}
          {diff.isRenamed && <span className="ml-2 tag">renamed</span>}
          {diff.isBinary && <span className="ml-2 tag">binary</span>}
        </div>
        <div className="flex items-center gap-1">
          <ToggleGroup
            value={state.diffMode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { label: 'Unified', value: 'unified' },
              { label: 'Split', value: 'split' },
            ]}
          />
          <button
            className={cn('btn-ghost', state.ignoreWhitespace && 'text-accent')}
            onClick={() => {
              dispatch({ type: 'setIgnoreWhitespace', value: !state.ignoreWhitespace });
              void loadDiff(selected);
            }}
            title="Toggle whitespace"
          >
            WS
          </button>
          <button
            className={cn('btn-ghost', state.diffStaged && 'text-accent')}
            onClick={() => {
              dispatch({ type: 'setDiffStaged', staged: !state.diffStaged });
              void loadDiff(selected);
            }}
            title="Toggle staged view"
          >
            Staged
          </button>
          <button className="btn" onClick={() => setComposer({ target: 'file', side: 'none', line: null, hunkHeader: null })}>
            Comment file
          </button>
          <button className={cn('btn', isReviewed && 'bg-success/20 border-success text-emerald-200')} onClick={() => void toggleReviewed()}>
            {isReviewed ? 'Reviewed ✓' : 'Mark reviewed'}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {diff.isBinary ? (
          <div className="p-6 text-sm text-text-muted">Binary file — diff not shown.</div>
        ) : diff.hunks.length === 0 ? (
          <div className="p-6 text-sm text-text-muted">No textual changes.</div>
        ) : (
          diff.hunks.map((h) => (
            <HunkBlock
              key={h.header}
              file={diff}
              hunk={h}
              mode={state.diffMode}
              comments={fileComments}
              staged={state.diffStaged}
              onStage={() => void stageHunk(h.header)}
              onUnstage={() => void unstageHunk(h.header)}
              onAddLineComment={(side, lineNumber) =>
                setComposer({ target: 'line', side, line: lineNumber, hunkHeader: h.header })
              }
              onAddHunkComment={() =>
                setComposer({ target: 'hunk', side: 'none', line: null, hunkHeader: h.header })
              }
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
    <div className="inline-flex bg-bg-subtle rounded border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          className={cn(
            'px-2 py-0.5 text-xs rounded',
            value === o.value ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:text-text-primary',
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function HunkBlock({
  file,
  hunk,
  mode,
  comments,
  staged,
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
  onStage: () => void;
  onUnstage: () => void;
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
  onAddHunkComment: () => void;
}) {
  const { state, dispatch } = useApp();
  const hunkKey = `${file.filePath}::${hunk.header}`;
  const selected = state.selectedHunkKeys.includes(hunkKey);
  return (
    <div className="border-b border-border-subtle">
      <div className="hunk-header">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => dispatch({ type: 'toggleHunkSelection', key: hunkKey })}
          />
          <span className="font-mono">{hunk.header}</span>
        </label>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-xs py-0" onClick={onAddHunkComment}>
            Comment hunk
          </button>
          {staged ? (
            <button className="btn-ghost text-xs py-0" onClick={onUnstage}>
              Unstage hunk
            </button>
          ) : (
            <button className="btn-ghost text-xs py-0" onClick={onStage}>
              Stage hunk
            </button>
          )}
        </div>
      </div>
      {mode === 'unified' ? (
        <UnifiedHunk
          file={file}
          hunk={hunk}
          comments={comments}
          onAddLineComment={onAddLineComment}
        />
      ) : (
        <SplitHunk file={file} hunk={hunk} comments={comments} onAddLineComment={onAddLineComment} />
      )}
    </div>
  );
}

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
  file,
  hunk,
  comments,
  onAddLineComment,
}: {
  file: FileDiff;
  hunk: DiffHunk;
  comments: ReviewComment[];
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  const lineCommentMap = useMemo(() => commentsByLine(comments), [comments]);
  return (
    <div>
      {hunk.lines.map((l, idx) => (
        <UnifiedRow key={idx} line={l} lineCommentMap={lineCommentMap} onAddLineComment={onAddLineComment} />
      ))}
    </div>
  );
}

function UnifiedRow({
  line,
  lineCommentMap,
  onAddLineComment,
}: {
  line: DiffLine;
  lineCommentMap: Map<string, ReviewComment[]>;
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  const cls =
    line.kind === 'add' ? 'add' : line.kind === 'del' ? 'del' : line.kind === 'meta' ? 'context italic text-text-muted' : 'context';
  // Prefer new side for add/context; old side for del. If both null (meta), skip comment hooks.
  const side: 'old' | 'new' | null = line.kind === 'del' ? 'old' : line.kind === 'add' ? 'new' : line.newLineNumber != null ? 'new' : line.oldLineNumber != null ? 'old' : null;
  const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
  const key = side && lineNumber != null ? lineKey(side, lineNumber) : null;
  const inlineComments = key ? lineCommentMap.get(key) ?? [] : [];
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
              className="absolute right-1 top-0 opacity-0 group-hover:opacity-100 btn-ghost py-0 px-1 text-[10px]"
              onClick={() => onAddLineComment(side, lineNumber)}
              title="Comment line (or double-click)"
            >
              💬
            </button>
          )}
        </div>
      </div>
      {inlineComments.map((c) => (
        <InlineCommentRow key={c.id} comment={c} />
      ))}
    </>
  );
}

function SplitHunk({
  file,
  hunk,
  comments,
  onAddLineComment,
}: {
  file: FileDiff;
  hunk: DiffHunk;
  comments: ReviewComment[];
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  // Build paired rows by walking the hunk and pairing del with subsequent add lines.
  type Row = { left: DiffLine | null; right: DiffLine | null };
  const rows: Row[] = [];
  let i = 0;
  while (i < hunk.lines.length) {
    const l = hunk.lines[i];
    if (l.kind === 'context') {
      rows.push({ left: l, right: l });
      i++;
    } else if (l.kind === 'del') {
      // Collect a run of dels and a following run of adds, pair them.
      const dels: DiffLine[] = [];
      while (i < hunk.lines.length && hunk.lines[i].kind === 'del') {
        dels.push(hunk.lines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < hunk.lines.length && hunk.lines[i].kind === 'add') {
        adds.push(hunk.lines[i]);
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
      // meta
      rows.push({ left: l, right: l });
      i++;
    }
  }
  const lineCommentMap = useMemo(() => commentsByLine(comments), [comments]);

  return (
    <div className="grid grid-cols-2 divide-x divide-border-subtle">
      <div>
        {rows.map((r, idx) => (
          <SideCell
            key={`l${idx}`}
            line={r.left}
            side="old"
            lineCommentMap={lineCommentMap}
            onAddLineComment={onAddLineComment}
          />
        ))}
      </div>
      <div>
        {rows.map((r, idx) => (
          <SideCell
            key={`r${idx}`}
            line={r.right}
            side="new"
            lineCommentMap={lineCommentMap}
            onAddLineComment={onAddLineComment}
          />
        ))}
      </div>
    </div>
  );
}

function SideCell({
  line,
  side,
  lineCommentMap,
  onAddLineComment,
}: {
  line: DiffLine | null;
  side: 'old' | 'new';
  lineCommentMap: Map<string, ReviewComment[]>;
  onAddLineComment: (side: 'old' | 'new', lineNumber: number) => void;
}) {
  if (!line) {
    return <div className="diff-line context">
      <div className="gut" />
      <div className="gut" />
      <div className="body" />
    </div>;
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
        className={cn('diff-line group', cls, inlineComments.length && 'has-comment')}
        onDoubleClick={() => {
          if (lineNumber != null) onAddLineComment(side, lineNumber);
        }}
      >
        <div className="gut">{lineNumber ?? ''}</div>
        <div className="gut" />
        <div className="body relative">
          {line.content}
          {lineNumber != null && (
            <button
              className="absolute right-1 top-0 opacity-0 group-hover:opacity-100 btn-ghost py-0 px-1 text-[10px]"
              onClick={() => onAddLineComment(side, lineNumber)}
            >
              💬
            </button>
          )}
        </div>
      </div>
      {inlineComments.map((c) => (
        <InlineCommentRow key={c.id} comment={c} />
      ))}
    </>
  );
}

function InlineCommentRow({ comment }: { comment: ReviewComment }) {
  const { loadComments, toast } = useApp();
  const resolve = async () => {
    try {
      await api.updateComment(comment.id, { status: comment.status === 'open' ? 'resolved' : 'open' });
      await loadComments();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <div className="px-12 py-2 bg-bg-subtle border-y border-border-subtle">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-xs text-text-muted mb-1">
            {comment.label && <span className="tag mr-1">{comment.label}</span>}
            {new Date(comment.created_at).toLocaleString()}
            {comment.status === 'resolved' && <span className="ml-1 text-success">✓ resolved</span>}
          </div>
          <div className="whitespace-pre-wrap text-sm">{comment.body}</div>
        </div>
        <button className="btn-ghost text-xs" onClick={() => void resolve()}>
          {comment.status === 'open' ? 'Resolve' : 'Reopen'}
        </button>
      </div>
    </div>
  );
}
