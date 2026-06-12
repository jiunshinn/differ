import { create } from 'zustand';
import type { Repository, ReviewSession } from '@shared/types';

export type View = 'picker' | 'local' | 'pr-list' | 'pr-detail' | 'issues' | 'history' | 'code';
export type RightPanelTab = 'overview' | 'comments';
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
  | 'fetch';

export interface ActivityEvent {
  id: number;
  kind: ActivityKind;
  message: string;
  detail?: string;
  at: number;
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
  ActivitySlice &
  ToastSlice;

const ACTIVITY_MAX = 30;
let activityIdSeq = 1;
let toastIdSeq = 1;

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
  activity: [],
  toast: null,
  lastFetchedAt: null,

  setView: (view) =>
    set((state) => {
      // Views that operate on the repo's LOCAL review session. When navigating
      // to one of these, drop any lingering PR review session so refresh()
      // re-resolves the local session instead of reusing the PR one.
      const localSessionView = view === 'local' || view === 'code' || view === 'history';
      const isPrSession =
        state.session != null &&
        (state.session.kind === 'pull_request' || state.session.github_pr_number != null);
      if (localSessionView && isPrSession) {
        return { view, session: null, selectedFile: null };
      }
      return { view };
    }),
  setRepo: (repo) =>
    set({
      repo,
      session: null,
      selectedFile: null,
      prNumber: null,
      lastFetchedAt: null,
      // Reset per-repo UI so state does not leak across repositories.
      fileFilter: '',
      diffStaged: false,
      rightPanelTab: 'overview',
      historyTab: 'graph',
      activity: [],
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
