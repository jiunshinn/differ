import React, { useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import type { CommentLabel, ReviewComment } from '@shared/types';

type Tab = 'comments' | 'context';

export default function RightPanel() {
  const [tab, setTab] = useState<Tab>('comments');
  return (
    <div className="h-full flex flex-col">
      <div className="h-9 px-2 border-b border-border flex items-center gap-1">
        <TabBtn active={tab === 'comments'} onClick={() => setTab('comments')}>
          Comments
        </TabBtn>
        <TabBtn active={tab === 'context'} onClick={() => setTab('context')}>
          Context
        </TabBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'comments' ? <CommentsPanel /> : <ContextSelectionsPanel />}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={cn('px-2 py-1 rounded text-sm', active ? 'bg-bg-hover' : 'hover:bg-bg-subtle')} onClick={onClick}>
      {children}
    </button>
  );
}

function CommentsPanel() {
  const { state, dispatch, loadComments, toast } = useApp();
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
      await loadComments();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const select = (filePath: string) => dispatch({ type: 'setSelectedFile', filePath });

  return (
    <div className="p-2">
      <div className="flex gap-1 mb-2">
        {(['all', 'open', 'resolved', 'ask-ai'] as const).map((f) => (
          <button
            key={f}
            className={cn('btn-ghost text-xs', filter === f && 'text-accent bg-bg-hover')}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {!comments.length && <div className="text-sm text-text-muted p-2">No comments.</div>}
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className="panel p-2">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={state.selectedCommentIds.includes(c.id)}
                onChange={() => onToggleSelect(c.id)}
              />
              <div className="flex-1 min-w-0">
                <button className="text-xs font-mono text-text-secondary truncate hover:text-accent" onClick={() => select(c.file_path)}>
                  {c.file_path}
                </button>
                <div className="text-[11px] text-text-muted">
                  {c.target_kind}
                  {c.target_kind === 'line' && c.line_number != null
                    ? ` ${c.diff_side === 'old' ? '-' : '+'}${c.line_number}`
                    : ''}
                  {c.target_kind === 'hunk' && c.hunk_header ? ` ${c.hunk_header}` : ''}
                  {c.label && <span className="ml-1 tag">{c.label}</span>}
                  {c.status === 'resolved' && <span className="ml-1 text-success">✓</span>}
                </div>
                <div className="whitespace-pre-wrap text-sm mt-1">{c.body}</div>
                <div className="flex items-center gap-2 mt-1">
                  <button className="btn-ghost text-[11px]" onClick={() => void onResolve(c)}>
                    {c.status === 'open' ? 'Resolve' : 'Reopen'}
                  </button>
                  <LabelChooser comment={c} />
                  <button className="btn-ghost text-[11px] text-danger" onClick={() => void onDelete(c.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
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
      className="bg-bg-subtle border border-border rounded text-[11px] py-0.5"
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

function ContextSelectionsPanel() {
  const { state, dispatch } = useApp();
  return (
    <div className="p-2">
      <h3 className="text-xs uppercase tracking-wide text-text-muted mb-1">Selected for context</h3>
      <div className="text-xs text-text-muted mb-3">
        Build an AI-agent context bundle in the Context tab. Selections persist across files.
      </div>
      <Section title={`Comments (${state.selectedCommentIds.length})`}>
        {state.comments
          .filter((c) => state.selectedCommentIds.includes(c.id))
          .map((c) => (
            <li key={c.id} className="text-xs flex justify-between gap-2 py-0.5">
              <span className="truncate">
                <span className="font-mono">{c.file_path}</span> {c.target_kind}
                {c.line_number ? ` L${c.line_number}` : ''}
              </span>
              <button
                className="btn-ghost text-[10px]"
                onClick={() => dispatch({ type: 'toggleCommentSelection', id: c.id, on: false })}
              >
                ×
              </button>
            </li>
          ))}
      </Section>
      <Section title={`Hunks (${state.selectedHunkKeys.length})`}>
        {state.selectedHunkKeys.map((k) => (
          <li key={k} className="text-xs flex justify-between gap-2 py-0.5">
            <span className="truncate font-mono">{k}</span>
            <button
              className="btn-ghost text-[10px]"
              onClick={() => dispatch({ type: 'toggleHunkSelection', key: k, on: false })}
            >
              ×
            </button>
          </li>
        ))}
      </Section>
      <Section title={`Files (${state.selectedFilePaths.length})`}>
        {state.selectedFilePaths.map((p) => (
          <li key={p} className="text-xs flex justify-between gap-2 py-0.5">
            <span className="truncate font-mono">{p}</span>
            <button
              className="btn-ghost text-[10px]"
              onClick={() => dispatch({ type: 'toggleFileSelection', path: p, on: false })}
            >
              ×
            </button>
          </li>
        ))}
      </Section>
      <div className="flex gap-1 mt-3">
        <button className="btn-primary text-xs" onClick={() => dispatch({ type: 'view', view: 'context' })}>
          Open Context Builder →
        </button>
        <button className="btn text-xs" onClick={() => dispatch({ type: 'clearSelections' })}>
          Clear
        </button>
      </div>
      <div className="mt-3 panel p-2 text-xs">
        <div className="text-text-muted mb-1">Quick add current file</div>
        <button
          className="btn text-xs"
          disabled={!state.selectedFile}
          onClick={() => state.selectedFile && dispatch({ type: 'toggleFileSelection', path: state.selectedFile })}
        >
          Toggle file in context
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h4 className="text-[11px] text-text-muted uppercase tracking-wide mb-1">{title}</h4>
      <ul className="panel p-1.5">
        {React.Children.count(children) === 0 ? <li className="text-xs text-text-muted">None.</li> : children}
      </ul>
    </div>
  );
}
