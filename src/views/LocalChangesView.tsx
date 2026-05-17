import React, { useEffect } from 'react';
import { useApp } from '../state/AppStore';
import ChangedFilesPanel from '../components/ChangedFilesPanel';
import DiffViewer from '../components/DiffViewer';
import ReviewPanel from '../components/ReviewPanel';
import LeftRail from '../components/LeftRail';
import ResizableLayout from '../components/ResizableLayout';

export default function LocalChangesView() {
  const { state, refresh } = useApp();

  useEffect(() => {
    if (state.repo) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.repo]);

  if (!state.repo) return null;

  return (
    <ResizableLayout
      storageKey="local-changes"
      className="h-full w-full min-h-0 bg-bg-panel"
      panes={[
        { defaultSize: 220, minSize: 180, maxSize: 360 },
        { defaultSize: 260, minSize: 200, maxSize: 480 },
        { defaultSize: 0, minSize: 320, flex: true },
        { defaultSize: 360, minSize: 280, maxSize: 600 },
      ]}
    >
      <LeftRail />
      <ChangedFilesPanel />
      <DiffViewer />
      <ReviewPanel />
    </ResizableLayout>
  );
}
