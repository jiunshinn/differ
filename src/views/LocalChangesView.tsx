import React, { useEffect } from 'react';
import { useApp } from '../state/AppStore';
import ChangedFilesPanel from '../components/ChangedFilesPanel';
import DiffViewer from '../components/DiffViewer';
import ReviewPanel from '../components/ReviewPanel';
import LeftRail from '../components/LeftRail';

export default function LocalChangesView() {
  const { state, refresh } = useApp();

  useEffect(() => {
    if (state.repo) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.repo]);

  if (!state.repo) return null;

  return (
    <div className="h-full w-full grid grid-cols-[220px_260px_minmax(0,1fr)_360px] min-h-0 bg-bg-panel">
      <LeftRail />
      <ChangedFilesPanel />
      <DiffViewer />
      <ReviewPanel />
    </div>
  );
}
