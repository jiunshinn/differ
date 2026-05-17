import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';

export default function ContextBuilderView() {
  const { state, dispatch, toast } = useApp();
  const [task, setTask] = useState('Verify the selected changes and improve where appropriate.');
  const [testCommand, setTestCommand] = useState('');
  const [includeRepoMetadata, setIncludeRepoMetadata] = useState(true);
  const [includeFullFiles, setIncludeFullFiles] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'ask-ai'>('all');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  const filteredComments = useMemo(() => {
    if (filter === 'open') return state.comments.filter((c) => c.status === 'open');
    if (filter === 'ask-ai') return state.comments.filter((c) => c.label === 'ask-ai');
    return state.comments;
  }, [state.comments, filter]);

  const hunks = useMemo(
    () =>
      state.selectedHunkKeys.map((k) => {
        const idx = k.indexOf('::');
        return { filePath: k.slice(0, idx), hunkHeader: k.slice(idx + 2) };
      }),
    [state.selectedHunkKeys],
  );

  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    task,
    testCommand,
    includeRepoMetadata,
    includeFullFiles,
    state.selectedCommentIds.join('|'),
    state.selectedFilePaths.join('|'),
    state.selectedHunkKeys.join('|'),
  ]);

  if (!state.repo || !state.session) {
    return <div className="p-6 text-text-muted">Open a repository first.</div>;
  }

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.previewContext({
        sessionId: state.session!.id,
        task,
        testCommand: testCommand.trim() || undefined,
        includeRepoMetadata,
        includeFullFiles,
        commentIds: state.selectedCommentIds,
        filePaths: state.selectedFilePaths,
        hunks,
      });
      setPreview(r.markdown);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await api.copyContext(preview);
      toast('success', 'Context copied to clipboard');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const save = async () => {
    if (!state.session) return;
    try {
      await api.saveContext({
        sessionId: state.session.id,
        title: task.split('\n')[0]?.slice(0, 80) || 'Context bundle',
        task,
        output: preview,
        included: {
          comments: state.selectedCommentIds,
          files: state.selectedFilePaths,
          hunks,
        },
      });
      toast('success', 'Context bundle saved');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="h-full flex">
      <div className="w-[420px] border-r border-border p-3 flex flex-col gap-3 overflow-auto">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-1">Task</div>
          <textarea
            className="input font-sans min-h-[110px]"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what you want the AI agent to do"
          />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-1">Test command (optional)</div>
          <input
            className="input font-mono"
            value={testCommand}
            onChange={(e) => setTestCommand(e.target.value)}
            placeholder="e.g. npm test"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Check label="Include repository metadata" value={includeRepoMetadata} onChange={setIncludeRepoMetadata} />
          <Check label="Include full file contents for selected files" value={includeFullFiles} onChange={setIncludeFullFiles} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-wide text-text-muted">Comments</div>
            <div className="flex gap-1">
              {(['all', 'open', 'ask-ai'] as const).map((f) => (
                <button
                  key={f}
                  className={cn('btn-ghost text-[11px]', filter === f && 'text-accent bg-bg-hover')}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="panel p-2 max-h-[260px] overflow-auto">
            {filteredComments.length === 0 && <div className="text-xs text-text-muted">No comments.</div>}
            {filteredComments.map((c) => (
              <label key={c.id} className="flex items-start gap-2 py-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={state.selectedCommentIds.includes(c.id)}
                  onChange={() => dispatch({ type: 'toggleCommentSelection', id: c.id })}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-text-secondary truncate">{c.file_path}</div>
                  <div className="text-text-muted">
                    {c.target_kind}
                    {c.line_number ? ` L${c.line_number}` : ''}
                    {c.label && <span className="ml-1 tag">{c.label}</span>}
                  </div>
                  <div className="whitespace-pre-wrap">{c.body}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-1">Files</div>
          <div className="panel p-2 max-h-[180px] overflow-auto">
            {state.files.length === 0 && <div className="text-xs text-text-muted">No changed files.</div>}
            {state.files.map((f) => (
              <label key={`${f.group}::${f.path}`} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.selectedFilePaths.includes(f.path)}
                  onChange={() => dispatch({ type: 'toggleFileSelection', path: f.path })}
                />
                <span className="truncate font-mono" title={f.path}>
                  {f.path}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-1">Hunks</div>
          <div className="panel p-2 max-h-[140px] overflow-auto">
            {state.selectedHunkKeys.length === 0 && (
              <div className="text-xs text-text-muted">
                Tick hunk checkboxes in the diff view to include them.
              </div>
            )}
            {state.selectedHunkKeys.map((k) => (
              <div key={k} className="text-xs font-mono py-0.5 truncate">
                {k}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-9 px-3 flex items-center gap-2 border-b border-border">
          <div className="text-sm text-text-secondary">Preview</div>
          <div className="text-xs text-text-muted">{preview.length} chars</div>
          <div className="flex-1" />
          <button className="btn" disabled={busy} onClick={() => void generate()}>
            Regenerate
          </button>
          <button className="btn" disabled={!preview} onClick={() => void save()}>
            Save bundle
          </button>
          <button className="btn-primary" disabled={!preview} onClick={() => void copy()}>
            Copy markdown
          </button>
        </div>
        <textarea
          className="flex-1 bg-bg font-mono text-xs leading-5 p-3 outline-none resize-none"
          value={preview}
          readOnly
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
