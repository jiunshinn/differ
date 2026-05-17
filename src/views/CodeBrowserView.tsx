import React, { useState } from 'react';
import { useApp } from '../state/AppStore';
import ResizableLayout from '../components/ResizableLayout';
import FileTree from '../components/FileTree';
import CodeViewer from '../components/CodeViewer';
import CommentComposer from '../components/CommentComposer';
import type { ReviewComment } from '@shared/types';

export default function CodeBrowserView() {
  const { state, dispatch, toast, logActivity } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [composer, setComposer] = useState<null | {
    target: 'line' | 'file';
    line: number | null;
  }>(null);
  const [selection, setSelection] = useState<{ startLine: number; endLine: number } | null>(null);

  if (!state.repo) return null;

  const sessionId = state.session?.id;
  const fileComments = selected ? state.comments.filter((c) => c.file_path === selected) : [];

  const extractFile = () => {
    if (!selected) return;
    dispatch({ type: 'toggleFileSelection', path: selected, on: true });
    dispatch({ type: 'setRightPanelTab', tab: 'context' });
    logActivity({ kind: 'context_extracted', message: 'Added file to context', detail: selected });
    toast('success', 'File added to context');
  };

  const extractSelection = () => {
    if (!selected || !selection) return;
    dispatch({
      type: 'toggleLineRangeSelection',
      range: { filePath: selected, startLine: selection.startLine, endLine: selection.endLine },
      on: true,
    });
    dispatch({ type: 'setRightPanelTab', tab: 'context' });
    logActivity({
      kind: 'context_extracted',
      message: 'Added snippet to context',
      detail: `${selected} L${selection.startLine}-${selection.endLine}`,
    });
    toast('success', `Snippet L${selection.startLine}-${selection.endLine} added to context`);
  };

  return (
    <ResizableLayout
      storageKey="code-browser"
      className="h-full w-full min-h-0 bg-bg-panel"
      panes={[
        { defaultSize: 300, minSize: 200, maxSize: 520 },
        { defaultSize: 0, minSize: 320, flex: true },
      ]}
    >
      <aside className="h-full min-h-0 overflow-auto border-r border-border bg-bg">
        <div className="h-9 px-3 flex items-center text-[10px] uppercase tracking-[0.08em] text-text-muted font-semibold border-b border-border">
          Files
        </div>
        <FileTree
          repoId={state.repo.id}
          selectedPath={selected}
          onSelectFile={setSelected}
        />
      </aside>
      <section className="h-full min-h-0 flex flex-col bg-bg-panel">
        <div className="min-h-9 px-3 py-1.5 flex items-center gap-2 border-b border-border text-xs text-text-secondary font-mono">
          <span className="truncate flex-1">
            {selected ?? <span className="text-text-muted">No file selected</span>}
          </span>
          {selected && (
            <div className="flex items-center gap-1.5 flex-none">
              <button
                className="btn h-7 text-xs px-2"
                disabled={!selection}
                onClick={extractSelection}
                title={
                  selection
                    ? `Add lines ${selection.startLine}-${selection.endLine} to context`
                    : 'Select lines in the editor to enable'
                }
              >
                {selection ? `Extract L${selection.startLine}-${selection.endLine}` : 'Extract selection'}
              </button>
              <button className="btn h-7 text-xs px-2" onClick={extractFile} title="Add whole file to context">
                Extract file
              </button>
              <button
                className="btn h-7 text-xs px-2"
                disabled={!sessionId || !selection}
                onClick={() => selection && setComposer({ target: 'line', line: selection.startLine })}
                title="Comment on the first selected line"
              >
                Comment lines
              </button>
              <button
                className="btn h-7 text-xs px-2"
                disabled={!sessionId}
                onClick={() => setComposer({ target: 'file', line: null })}
              >
                Comment file
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <CodeViewer
            repoId={state.repo.id}
            filePath={selected}
            onSelectionChange={setSelection}
            onAddLineComment={(line) => {
              if (!sessionId) {
                toast('error', 'No active session');
                return;
              }
              setComposer({ target: 'line', line });
            }}
          />
        </div>
        {selected && fileComments.length > 0 && (
          <FileCommentsStrip comments={fileComments} />
        )}
      </section>

      {composer && sessionId && selected && (
        <CommentComposer
          filePath={selected}
          target={composer.target}
          side={composer.target === 'line' ? 'new' : 'none'}
          line={composer.line}
          hunkHeader={null}
          onClose={() => setComposer(null)}
        />
      )}
    </ResizableLayout>
  );
}

function FileCommentsStrip({ comments }: { comments: ReviewComment[] }) {
  const { dispatch } = useApp();
  return (
    <div className="border-t border-border bg-bg-subtle max-h-[180px] overflow-auto">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-text-muted font-semibold">
        Comments on this file ({comments.length})
      </div>
      <ul className="px-2 pb-2 grid gap-1.5">
        {comments.map((c) => (
          <li key={c.id} className="border border-border rounded-card bg-bg-panel px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
              <span className="font-mono truncate">
                {c.target_kind === 'line' && c.line_number != null
                  ? `L${c.line_number}`
                  : c.target_kind === 'hunk' && c.hunk_header
                  ? c.hunk_header
                  : 'file'}
                {c.label && <span className="ml-1 chip">{c.label}</span>}
                {c.status === 'resolved' && <span className="ml-1 text-success">✓</span>}
              </span>
              <button
                className="btn-ghost h-6 text-[11px] px-2"
                onClick={() => {
                  dispatch({ type: 'toggleCommentSelection', id: c.id, on: true });
                  dispatch({ type: 'setRightPanelTab', tab: 'context' });
                }}
                title="Add comment to context bundle"
              >
                + context
              </button>
            </div>
            <div className="whitespace-pre-wrap text-sm mt-1">{c.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
