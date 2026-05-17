import React, { useState } from 'react';
import { useApp } from '../state/AppStore';
import ResizableLayout from '../components/ResizableLayout';
import FileTree from '../components/FileTree';
import CodeViewer from '../components/CodeViewer';

export default function CodeBrowserView() {
  const { state } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

  if (!state.repo) return null;

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
        <div className="h-9 px-3 flex items-center gap-2 border-b border-border text-xs text-text-secondary font-mono truncate">
          {selected ?? <span className="text-text-muted">No file selected</span>}
        </div>
        <div className="flex-1 min-h-0">
          <CodeViewer repoId={state.repo.id} filePath={selected} />
        </div>
      </section>
    </ResizableLayout>
  );
}
