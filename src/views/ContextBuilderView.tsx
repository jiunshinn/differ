import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import LeftRail from '../components/LeftRail';
import ResizableLayout from '../components/ResizableLayout';

export default function ContextBuilderView() {
  const { state, dispatch, toast, logActivity } = useApp();
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
    if (state.repo && state.session) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    task,
    testCommand,
    includeRepoMetadata,
    includeFullFiles,
    state.session?.id,
    state.selectedCommentIds.join('|'),
    state.selectedFilePaths.join('|'),
    state.selectedHunkKeys.join('|'),
  ]);

  if (!state.repo || !state.session) {
    return (
      <ResizableLayout
        storageKey="context-empty"
        className="h-full w-full min-h-0"
        panes={[
          { defaultSize: 220, minSize: 180, maxSize: 360 },
          { defaultSize: 0, minSize: 280, flex: true },
        ]}
      >
        <LeftRail />
        <div className="p-8 text-text-muted">Open a repository first.</div>
      </ResizableLayout>
    );
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
      logActivity({ kind: 'context_copied', message: 'Copied context to clipboard' });
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
    <ResizableLayout
      storageKey="context-builder"
      className="h-full w-full min-h-0 bg-bg-panel"
      panes={[
        { defaultSize: 220, minSize: 180, maxSize: 360 },
        { defaultSize: 420, minSize: 320, maxSize: 640 },
        { defaultSize: 0, minSize: 360, flex: true },
      ]}
    >
      <LeftRail />

      <aside className="overflow-auto border-r border-border p-4 bg-bg grid gap-3.5 content-start">
        <div>
          <div className="section-label mb-1.5">Task</div>
          <textarea
            className="input min-h-[110px] font-sans resize-y"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what you want the AI agent to do"
          />
        </div>
        <div>
          <div className="section-label mb-1.5">Test command (optional)</div>
          <input
            className="input font-mono"
            value={testCommand}
            onChange={(e) => setTestCommand(e.target.value)}
            placeholder="e.g. npm test"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Check label="Include repository metadata" value={includeRepoMetadata} onChange={setIncludeRepoMetadata} />
          <Check
            label="Include full file contents for selected files"
            value={includeFullFiles}
            onChange={setIncludeFullFiles}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="section-label">Comments</div>
            <div className="flex gap-1">
              {(['all', 'open', 'ask-ai'] as const).map((f) => (
                <button
                  key={f}
                  className={cn(
                    'h-6 px-1.5 rounded-md text-[11px] border',
                    filter === f
                      ? 'bg-bg-panel border-border text-text-primary'
                      : 'border-transparent text-text-muted hover:text-text-primary',
                  )}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-card p-2 max-h-[260px] overflow-auto">
            {filteredComments.length === 0 && <div className="text-xs text-text-muted px-1.5 py-1">No comments.</div>}
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
                    {c.label && <span className="ml-1 chip">{c.label}</span>}
                  </div>
                  <div className="whitespace-pre-wrap">{c.body}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="section-label mb-1.5">Files</div>
          <div className="panel-card p-2 max-h-[180px] overflow-auto">
            {state.files.length === 0 && <div className="text-xs text-text-muted px-1.5 py-1">No changed files.</div>}
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
          <div className="section-label mb-1.5">Hunks</div>
          <div className="panel-card p-2 max-h-[140px] overflow-auto">
            {state.selectedHunkKeys.length === 0 && (
              <div className="text-xs text-text-muted px-1.5 py-1">
                Tick hunk checkboxes in the diff view to include them.
              </div>
            )}
            {state.selectedHunkKeys.map((k) => (
              <div key={k} className="text-xs font-mono py-0.5 truncate" title={k}>
                {k}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-h-0 flex flex-col">
        <header className="h-12 px-4 flex items-center gap-2 border-b border-border bg-bg-panel">
          <div className="text-sm font-semibold tracking-tight">Preview</div>
          <div className="small-mono">{preview.length} chars</div>
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
        </header>
        <textarea
          className="flex-1 bg-bg font-mono text-xs leading-5 p-4 outline-none resize-none text-text-primary"
          value={preview}
          readOnly
          spellCheck={false}
        />
      </section>
    </ResizableLayout>
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
