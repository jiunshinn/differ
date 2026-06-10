import { create } from 'zustand';
import type { Repository, ReviewSession } from '@shared/types';

export type View = 'picker' | 'local' | 'pr-list' | 'pr-detail' | 'issues' | 'context' | 'history' | 'code';
export type RightPanelTab = 'overview' | 'comments' | 'context';
export type HistoryTab = 'graph' | 'resolve' | 'sync';

export type ActivityKind =
  | 'comment_created'
  | 'comment_resolved'
  | 'file_staged'
  | 'file_unstaged'
  | 'file_reviewed'
  | 'commit'
  | 'pull'
  | 'push'
  | 'fetch'
  | 'context_copied'
  | 'context_extracted';

export interface ActivityEvent {
  id: number;
  kind: ActivityKind;
  message: string;
  detail?: string;
  at: number;
}

export interface LineRangeSelection {
  filePath: string;
  startLine: number;
  endLine: number;
}

export function lineRangeKey(r: LineRangeSelection): string {
  return `${r.filePath}::${r.startLine}-${r.endLine}`;
}

export interface ToastState {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface ViewSlice {
  view: View;
  rightPanelTab: RightPanelTab;
  historyTab: HistoryTab;
  fileFilter: string;
  setView: (view: View) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setHistoryTab: (tab: HistoryTab) => void;
  setFileFilter: (value: string) => void;
}

interface RepoSlice {
  repo: Repository | null;
  session: ReviewSession | null;
  prNumber: number | null;
  lastFetchedAt: number | null;
  setRepo: (repo: Repository | null) => void;
  setSession: (session: ReviewSession | null) => void;
  setPrNumber: (n: number | null) => void;
  setLastFetchedAt: (at: number | null) => void;
}

interface DiffSlice {
  selectedFile: string | null;
  diffMode: 'unified' | 'split';
  diffStaged: boolean;
  diffFullscreen: boolean;
  ignoreWhitespace: boolean;
  setSelectedFile: (filePath: string | null) => void;
  setDiffMode: (mode: 'unified' | 'split') => void;
  setDiffStaged: (staged: boolean) => void;
  setDiffFullscreen: (value: boolean) => void;
  setIgnoreWhitespace: (value: boolean) => void;
}

interface SelectionSlice {
  selectedCommentIds: number[];
  selectedFilePaths: string[];
  selectedHunkKeys: string[];
  selectedLineRanges: LineRangeSelection[];
  toggleCommentSelection: (id: number, on?: boolean) => void;
  toggleFileSelection: (path: string, on?: boolean) => void;
  toggleHunkSelection: (key: string, on?: boolean) => void;
  toggleLineRangeSelection: (range: LineRangeSelection, on?: boolean) => void;
  clearSelections: () => void;
}

interface ActivitySlice {
  activity: ActivityEvent[];
  pushActivity: (event: Omit<ActivityEvent, 'id' | 'at'> & { at?: number }) => void;
}

interface ToastSlice {
  toast: ToastState | null;
  showToast: (kind: ToastState['kind'], message: string) => void;
  clearToast: (id?: number) => void;
}

export type AppClientStore = ViewSlice &
  RepoSlice &
  DiffSlice &
  SelectionSlice &
  ActivitySlice &
  ToastSlice;

const ACTIVITY_MAX = 30;
let activityIdSeq = 1;
let toastIdSeq = 1;

function toggleInArray<T>(items: T[], item: T, on?: boolean): T[] {
  const has = items.includes(item);
  const shouldInclude = on ?? !has;
  if (shouldInclude) return has ? items : [...items, item];
  return items.filter((x) => x !== item);
}

export const useAppStore = create<AppClientStore>()((set, get) => ({
  view: 'picker',
  repo: null,
  session: null,
  selectedFile: null,
  diffMode: 'split',
  diffStaged: false,
  diffFullscreen: false,
  ignoreWhitespace: false,
  prNumber: null,
  rightPanelTab: 'overview',
  historyTab: 'graph',
  fileFilter: '',
  selectedCommentIds: [],
  selectedFilePaths: [],
  selectedHunkKeys: [],
  selectedLineRanges: [],
  activity: [],
  toast: null,
  lastFetchedAt: null,

  setView: (view) => set({ view }),
  setRepo: (repo) =>
    set({
      repo,
      session: null,
      selectedFile: null,
      prNumber: null,
      selectedCommentIds: [],
      selectedFilePaths: [],
      selectedHunkKeys: [],
      selectedLineRanges: [],
      lastFetchedAt: null,
    }),
  setSession: (session) => set({ session }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setDiffMode: (diffMode) => set({ diffMode }),
  setDiffStaged: (diffStaged) => set({ diffStaged }),
  setDiffFullscreen: (diffFullscreen) => set({ diffFullscreen }),
  setIgnoreWhitespace: (ignoreWhitespace) => set({ ignoreWhitespace }),
  setPrNumber: (prNumber) => set({ prNumber }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setHistoryTab: (historyTab) => set({ historyTab }),
  setFileFilter: (fileFilter) => set({ fileFilter }),
  setLastFetchedAt: (lastFetchedAt) => set({ lastFetchedAt }),

  toggleCommentSelection: (id, on) =>
    set((state) => ({ selectedCommentIds: toggleInArray(state.selectedCommentIds, id, on) })),
  toggleFileSelection: (path, on) =>
    set((state) => ({ selectedFilePaths: toggleInArray(state.selectedFilePaths, path, on) })),
  toggleHunkSelection: (key, on) =>
    set((state) => ({ selectedHunkKeys: toggleInArray(state.selectedHunkKeys, key, on) })),
  toggleLineRangeSelection: (range, on) =>
    set((state) => {
      const key = lineRangeKey(range);
      const has = state.selectedLineRanges.some((r) => lineRangeKey(r) === key);
      const shouldInclude = on ?? !has;
      return {
        selectedLineRanges: shouldInclude
          ? has
            ? state.selectedLineRanges
            : [...state.selectedLineRanges, range]
          : state.selectedLineRanges.filter((r) => lineRangeKey(r) !== key),
      };
    }),
  clearSelections: () =>
    set({
      selectedCommentIds: [],
      selectedFilePaths: [],
      selectedHunkKeys: [],
      selectedLineRanges: [],
    }),

  pushActivity: (event) =>
    set((state) => {
      const next: ActivityEvent = {
        id: activityIdSeq++,
        at: event.at ?? Date.now(),
        kind: event.kind,
        message: event.message,
        detail: event.detail,
      };
      return { activity: [next, ...state.activity].slice(0, ACTIVITY_MAX) };
    }),

  showToast: (kind, message) => {
    const id = toastIdSeq++;
    set({ toast: { id, kind, message } });
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3200);
  },
  clearToast: (id) =>
    set((state) => {
      if (id !== undefined && state.toast?.id !== id) return {};
      return { toast: null };
    }),
}));

export const appSelectors = {
  view: (state: AppClientStore) => state.view,
  repo: (state: AppClientStore) => state.repo,
  repoId: (state: AppClientStore) => state.repo?.id ?? null,
  session: (state: AppClientStore) => state.session,
  sessionId: (state: AppClientStore) => state.session?.id ?? null,
  selectedFile: (state: AppClientStore) => state.selectedFile,
  diffOptions: (state: AppClientStore) => ({
    diffMode: state.diffMode,
    diffStaged: state.diffStaged,
    diffFullscreen: state.diffFullscreen,
    ignoreWhitespace: state.ignoreWhitespace,
  }),
  selections: (state: AppClientStore) => ({
    selectedCommentIds: state.selectedCommentIds,
    selectedFilePaths: state.selectedFilePaths,
    selectedHunkKeys: state.selectedHunkKeys,
    selectedLineRanges: state.selectedLineRanges,
  }),
  toast: (state: AppClientStore) => state.toast,
  actions: (state: AppClientStore) => ({
    setView: state.setView,
    setRepo: state.setRepo,
    setSession: state.setSession,
    setSelectedFile: state.setSelectedFile,
    setDiffMode: state.setDiffMode,
    setDiffStaged: state.setDiffStaged,
    setDiffFullscreen: state.setDiffFullscreen,
    setIgnoreWhitespace: state.setIgnoreWhitespace,
    setPrNumber: state.setPrNumber,
    setRightPanelTab: state.setRightPanelTab,
    setHistoryTab: state.setHistoryTab,
    setFileFilter: state.setFileFilter,
    setLastFetchedAt: state.setLastFetchedAt,
    toggleCommentSelection: state.toggleCommentSelection,
    toggleFileSelection: state.toggleFileSelection,
    toggleHunkSelection: state.toggleHunkSelection,
    toggleLineRangeSelection: state.toggleLineRangeSelection,
    clearSelections: state.clearSelections,
    pushActivity: state.pushActivity,
    showToast: state.showToast,
  }),
};
