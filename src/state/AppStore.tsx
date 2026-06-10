import { useCallback, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
  commentsQueryOptions,
  fileDiffQueryOptions,
  fileStatesQueryOptions,
  invalidateRepoQueries,
  invalidateReviewQueries,
  localSessionQueryOptions,
  repoStatusQueryOptions,
  useCommentsQuery,
  useFileDiffQuery,
  useFileStatesQuery,
  useRepoStatusQuery,
} from '../query/hooks';
import { queryKeys } from '../query/keys';
import {
  useAppStore,
  type ActivityEvent,
  type ActivityKind,
  type HistoryTab,
  type RightPanelTab,
  type View,
} from './store';
import type {
  ChangedFile,
  FileDiff,
  FileReviewState,
  RepoStatus,
  Repository,
  ReviewComment,
  ReviewSession,
} from '@shared/types';

export type {
  ActivityEvent,
  ActivityKind,
  HistoryTab,
  RightPanelTab,
  View,
};
export { useAppStore };

export interface AppState {
  view: View;
  repo: Repository | null;
  session: ReviewSession | null;
  status: RepoStatus | null;
  selectedFile: string | null;
  files: ChangedFile[];
  diffMode: 'unified' | 'split';
  diffStaged: boolean;
  diffFullscreen: boolean;
  ignoreWhitespace: boolean;
  diffsByFile: Record<string, FileDiff | null | undefined>;
  comments: ReviewComment[];
  fileStates: FileReviewState[];
  prNumber: number | null;
  rightPanelTab: RightPanelTab;
  historyTab: HistoryTab;
  fileFilter: string;
  activity: ActivityEvent[];
  toast: { kind: 'info' | 'success' | 'error'; message: string } | null;
  lastFetchedAt: number | null;
}

type Action =
  | { type: 'view'; view: View }
  | { type: 'setRepo'; repo: Repository | null }
  | { type: 'setSession'; session: ReviewSession | null }
  | { type: 'setStatus'; status: RepoStatus | null }
  | { type: 'setSelectedFile'; filePath: string | null }
  | { type: 'setDiffMode'; mode: 'unified' | 'split' }
  | { type: 'setDiffStaged'; staged: boolean }
  | { type: 'setDiffFullscreen'; value: boolean }
  | { type: 'setIgnoreWhitespace'; value: boolean }
  | { type: 'setFileDiff'; filePath: string; diff: FileDiff | null }
  | { type: 'setComments'; comments: ReviewComment[] }
  | { type: 'setFileStates'; states: FileReviewState[] }
  | { type: 'setPrNumber'; n: number | null }
  | { type: 'setRightPanelTab'; tab: RightPanelTab }
  | { type: 'setHistoryTab'; tab: HistoryTab }
  | { type: 'setFileFilter'; value: string }
  | { type: 'pushActivity'; event: Omit<ActivityEvent, 'id' | 'at'> & { at?: number } }
  | { type: 'toast'; toast: AppState['toast'] }
  | { type: 'setLastFetchedAt'; at: number | null };

interface Ctx {
  state: AppState;
  dispatch: (action: Action) => void;
  refresh: () => Promise<void>;
  loadDiff: (filePath: string) => Promise<void>;
  loadComments: () => Promise<void>;
  loadFileStates: () => Promise<void>;
  logActivity: (event: Omit<ActivityEvent, 'id' | 'at'>) => void;
  toast: (kind: 'info' | 'success' | 'error', message: string) => void;
  silentFetch: () => Promise<void>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useApp(): Ctx {
  const clientState = useAppStore();
  const queryClient = useQueryClient();
  const repoId = clientState.repo?.id ?? null;
  const sessionId = clientState.session?.id ?? null;
  const statusQuery = useRepoStatusQuery(repoId);
  const commentsQuery = useCommentsQuery(sessionId);
  const fileStatesQuery = useFileStatesQuery(sessionId);
  const selectedDiffQuery = useFileDiffQuery({
    repoId,
    filePath: clientState.selectedFile,
    staged: clientState.diffStaged,
    ignoreWhitespace: clientState.ignoreWhitespace,
    includeUntracked: !clientState.diffStaged,
  });

  const toast = useCallback((kind: 'info' | 'success' | 'error', message: string) => {
    useAppStore.getState().showToast(kind, message);
  }, []);

  const logActivity = useCallback((event: Omit<ActivityEvent, 'id' | 'at'>) => {
    useAppStore.getState().pushActivity(event);
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = useAppStore.getState();
    if (!snapshot.repo) return;
    try {
      await queryClient.fetchQuery(repoStatusQueryOptions(snapshot.repo.id));
      const current = useAppStore.getState();
      let session = current.session;
      if (!session) {
        session = await queryClient.fetchQuery(localSessionQueryOptions(snapshot.repo.id));
        if (!session) return;
        useAppStore.getState().setSession(session);
        queryClient.setQueryData(queryKeys.session.detail(session.id), session);
      }
      if (!session) return;
      if (current.selectedFile) {
        await queryClient.fetchQuery(
          fileDiffQueryOptions(snapshot.repo.id, current.selectedFile, {
            staged: current.diffStaged,
            ignoreWhitespace: current.ignoreWhitespace,
            includeUntracked: !current.diffStaged,
          }),
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.session.comments(session.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.session.fileStates(session.id) }),
      ]);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }, [queryClient, toast]);

  const loadDiff = useCallback(
    async (filePath: string) => {
      const snapshot = useAppStore.getState();
      if (!snapshot.repo) return;
      try {
        await queryClient.fetchQuery(
          fileDiffQueryOptions(snapshot.repo.id, filePath, {
            staged: snapshot.diffStaged,
            ignoreWhitespace: snapshot.ignoreWhitespace,
            includeUntracked: !snapshot.diffStaged,
          }),
        );
        if (snapshot.session) {
          const states = await queryClient.fetchQuery(fileStatesQueryOptions(snapshot.session.id));
          const existing = states.find((fs) => fs.file_path === filePath);
          if (!existing || existing.status === 'unviewed') {
            await api.setFileState(snapshot.session.id, filePath, 'viewed');
            await invalidateReviewQueries(queryClient, snapshot.session.id);
          }
        }
      } catch (e) {
        toast('error', (e as Error).message);
      }
    },
    [queryClient, toast],
  );

  const loadComments = useCallback(async () => {
    const session = useAppStore.getState().session;
    if (!session) return;
    await queryClient.fetchQuery(commentsQueryOptions(session.id));
  }, [queryClient]);

  const loadFileStates = useCallback(async () => {
    const session = useAppStore.getState().session;
    if (!session) return;
    await queryClient.fetchQuery(fileStatesQueryOptions(session.id));
  }, [queryClient]);

  const silentFetch = useCallback(async () => {
    const repo = useAppStore.getState().repo;
    if (!repo) return;
    try {
      await api.fetch(repo.id);
      useAppStore.getState().setLastFetchedAt(Date.now());
      await invalidateRepoQueries(queryClient, repo.id);
    } catch {
      // Background fetch failures should not interrupt the user.
    }
  }, [queryClient]);

  const dispatch = useCallback(
    (action: Action) => {
      const store = useAppStore.getState();
      switch (action.type) {
        case 'view':
          store.setView(action.view);
          break;
        case 'setRepo':
          store.setRepo(action.repo);
          break;
        case 'setSession':
          store.setSession(action.session);
          if (action.session) queryClient.setQueryData(queryKeys.session.detail(action.session.id), action.session);
          break;
        case 'setStatus': {
          const repo = store.repo;
          if (repo && action.status) queryClient.setQueryData(queryKeys.repo.status(repo.id), action.status);
          break;
        }
        case 'setSelectedFile':
          store.setSelectedFile(action.filePath);
          break;
        case 'setDiffMode':
          store.setDiffMode(action.mode);
          break;
        case 'setDiffStaged':
          store.setDiffStaged(action.staged);
          break;
        case 'setDiffFullscreen':
          store.setDiffFullscreen(action.value);
          break;
        case 'setIgnoreWhitespace':
          store.setIgnoreWhitespace(action.value);
          break;
        case 'setFileDiff': {
          const repo = store.repo;
          if (repo) {
            queryClient.setQueryData(
              queryKeys.diff.file(repo.id, action.filePath, {
                staged: store.diffStaged,
                ignoreWhitespace: store.ignoreWhitespace,
                includeUntracked: !store.diffStaged,
              }),
              action.diff,
            );
          }
          break;
        }
        case 'setComments': {
          const session = store.session;
          if (session) queryClient.setQueryData(queryKeys.session.comments(session.id), action.comments);
          break;
        }
        case 'setFileStates': {
          const session = store.session;
          if (session) queryClient.setQueryData(queryKeys.session.fileStates(session.id), action.states);
          break;
        }
        case 'setPrNumber':
          store.setPrNumber(action.n);
          break;
        case 'setRightPanelTab':
          store.setRightPanelTab(action.tab);
          break;
        case 'setHistoryTab':
          store.setHistoryTab(action.tab);
          break;
        case 'setFileFilter':
          store.setFileFilter(action.value);
          break;
        case 'pushActivity':
          store.pushActivity(action.event);
          break;
        case 'toast':
          if (action.toast) store.showToast(action.toast.kind, action.toast.message);
          else store.clearToast();
          break;
        case 'setLastFetchedAt':
          store.setLastFetchedAt(action.at);
          break;
        default:
          action satisfies never;
      }
    },
    [queryClient],
  );

  const diffsByFile = useMemo(() => {
    if (!clientState.selectedFile) return {};
    return { [clientState.selectedFile]: selectedDiffQuery.data };
  }, [clientState.selectedFile, selectedDiffQuery.data]);

  const state = useMemo<AppState>(
    () => ({
      view: clientState.view,
      repo: clientState.repo,
      session: clientState.session,
      status: statusQuery.data ?? null,
      selectedFile: clientState.selectedFile,
      files: statusQuery.data?.files ?? [],
      diffMode: clientState.diffMode,
      diffStaged: clientState.diffStaged,
      diffFullscreen: clientState.diffFullscreen,
      ignoreWhitespace: clientState.ignoreWhitespace,
      diffsByFile,
      comments: commentsQuery.data ?? [],
      fileStates: fileStatesQuery.data ?? [],
      prNumber: clientState.prNumber,
      rightPanelTab: clientState.rightPanelTab,
      historyTab: clientState.historyTab,
      fileFilter: clientState.fileFilter,
      activity: clientState.activity,
      toast: clientState.toast ? { kind: clientState.toast.kind, message: clientState.toast.message } : null,
      lastFetchedAt: clientState.lastFetchedAt,
    }),
    [
      clientState.activity,
      clientState.diffFullscreen,
      clientState.diffMode,
      clientState.diffStaged,
      clientState.fileFilter,
      clientState.historyTab,
      clientState.ignoreWhitespace,
      clientState.lastFetchedAt,
      clientState.prNumber,
      clientState.repo,
      clientState.rightPanelTab,
      clientState.selectedFile,
      clientState.session,
      clientState.toast,
      clientState.view,
      commentsQuery.data,
      diffsByFile,
      fileStatesQuery.data,
      statusQuery.data,
    ],
  );

  return useMemo<Ctx>(
    () => ({ state, dispatch, refresh, loadDiff, loadComments, loadFileStates, logActivity, toast, silentFetch }),
    [state, dispatch, refresh, loadDiff, loadComments, loadFileStates, logActivity, toast, silentFetch],
  );
}
