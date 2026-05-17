import React, { useEffect, useMemo } from 'react';
import { useApp } from '../state/AppStore';
import ChangedFilesPanel from '../components/ChangedFilesPanel';
import DiffViewer from '../components/DiffViewer';
import ReviewPanel from '../components/ReviewPanel';
import LeftRail from '../components/LeftRail';
import ResizableLayout from '../components/ResizableLayout';

export default function LocalChangesView() {
  const { state, dispatch, refresh, loadDiff } = useApp();

  useEffect(() => {
    if (state.repo) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.repo]);

  const filteredFiles = useMemo(() => {
    const filter = state.fileFilter.trim().toLowerCase();
    return filter ? state.files.filter((f) => f.path.toLowerCase().includes(filter)) : state.files;
  }, [state.files, state.fileFilter]);

  useEffect(() => {
    if (!state.diffFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = target?.isContentEditable;
      if (editable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch({ type: 'setDiffFullscreen', value: false });
        return;
      }
      if (!filteredFiles.length) return;
      const isNext = e.key === 'j' || e.key === 'ArrowDown';
      const isPrev = e.key === 'k' || e.key === 'ArrowUp';
      if (!isNext && !isPrev) return;
      e.preventDefault();
      const currentIdx = filteredFiles.findIndex(
        (f) => f.path === state.selectedFile && (f.group === 'staged') === state.diffStaged,
      );
      const fallback = filteredFiles.findIndex((f) => f.path === state.selectedFile);
      const baseIdx = currentIdx >= 0 ? currentIdx : fallback;
      let nextIdx: number;
      if (baseIdx < 0) {
        nextIdx = isNext ? 0 : filteredFiles.length - 1;
      } else {
        nextIdx = (baseIdx + (isNext ? 1 : -1) + filteredFiles.length) % filteredFiles.length;
      }
      const next = filteredFiles[nextIdx];
      dispatch({ type: 'setSelectedFile', filePath: next.path });
      dispatch({ type: 'setDiffStaged', staged: next.group === 'staged' });
      void loadDiff(next.path);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    state.diffFullscreen,
    state.selectedFile,
    state.diffStaged,
    filteredFiles,
    dispatch,
    loadDiff,
  ]);

  if (!state.repo) return null;

  if (state.diffFullscreen) {
    return (
      <div className="fixed inset-0 z-40 bg-bg-panel grid grid-rows-[minmax(0,1fr)]">
        <DiffViewer />
      </div>
    );
  }

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
