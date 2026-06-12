import React, { useEffect, useMemo, useRef } from 'react';
import { useApp, useFileFilter } from '../state/AppStore';
import ChangedFilesPanel from '../components/ChangedFilesPanel';
import DiffViewer from '../components/DiffViewer';
import ReviewPanel from '../components/ReviewPanel';
import CommitBar from '../components/CommitBar';
import ResizableLayout from '../components/ResizableLayout';

export default function LocalChangesView() {
  const { state, dispatch, refresh, loadDiff } = useApp();
  const [fileFilter] = useFileFilter();
  const repoId = state.repo?.id ?? null;

  useEffect(() => {
    if (repoId !== null) void refresh();
  }, [repoId, refresh]);

  const filteredFiles = useMemo(() => {
    const filter = fileFilter.trim().toLowerCase();
    return filter ? state.files.filter((f) => f.path.toLowerCase().includes(filter)) : state.files;
  }, [state.files, fileFilter]);

  // Dwell timer so j/k navigation doesn't mark every skimmed file 'viewed'. The
  // diff itself loads via the always-mounted useFileDiffQuery as soon as
  // selectedFile/diffStaged change; loadDiff (which writes the 'viewed' state) is
  // deferred until the user actually settles on a file for ~500ms.
  const dwellTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!state.diffFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = target?.isContentEditable;
      if (editable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Don't fight an open dialog (e.g. the comment composer): Escape and j/k
      // must belong to the dialog, not the fullscreen diff behind it.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

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
      // Coalesce OS key auto-repeat: a held key fires a stream of repeat events;
      // ignore them and advance one file per discrete press.
      if (e.repeat) return;
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
      // Defer the 'mark viewed' write until the user dwells on this file.
      if (dwellTimer.current !== null) window.clearTimeout(dwellTimer.current);
      dwellTimer.current = window.setTimeout(() => {
        dwellTimer.current = null;
        void loadDiff(next.path);
      }, 500);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (dwellTimer.current !== null) {
        window.clearTimeout(dwellTimer.current);
        dwellTimer.current = null;
      }
    };
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
        { defaultSize: 300, minSize: 240, maxSize: 520 },
        { defaultSize: 0, minSize: 320, flex: true },
        { defaultSize: 360, minSize: 280, maxSize: 600 },
      ]}
    >
      <div className="flex flex-col min-h-0 border-r border-border bg-bg">
        <ChangedFilesPanel />
        {state.session && (
          <div className="p-3.5 border-t border-border shrink-0">
            <CommitBar />
          </div>
        )}
      </div>
      <DiffViewer />
      <ReviewPanel />
    </ResizableLayout>
  );
}
