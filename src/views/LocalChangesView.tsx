import React, { useEffect } from 'react';
import { useApp } from '../state/AppStore';
import ChangedFilesPanel from '../components/ChangedFilesPanel';
import DiffViewer from '../components/DiffViewer';
import RightPanel from '../components/RightPanel';
import CommitBar from '../components/CommitBar';

export default function LocalChangesView() {
  const { state, refresh } = useApp();

  useEffect(() => {
    if (state.repo) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.repo]);

  if (!state.repo) return null;

  return (
    <div className="flex h-full w-full">
      <div className="w-72 min-w-[240px] border-r border-border bg-bg-panel flex flex-col">
        <ChangedFilesPanel />
        <CommitBar />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <DiffViewer />
      </div>
      <div className="w-[360px] min-w-[300px] border-l border-border bg-bg-panel">
        <RightPanel />
      </div>
    </div>
  );
}
