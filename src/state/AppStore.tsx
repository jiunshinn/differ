import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { api } from '../api';
import type {
  ChangedFile,
  FileDiff,
  FileReviewState,
  RepoStatus,
  Repository,
  ReviewComment,
  ReviewSession,
} from '@shared/types';

export type View = 'picker' | 'local' | 'pr-list' | 'pr-detail' | 'context';

export interface AppState {
  view: View;
  repo: Repository | null;
  session: ReviewSession | null;
  status: RepoStatus | null;
  selectedFile: string | null;
  files: ChangedFile[];
  diffMode: 'unified' | 'split';
  diffStaged: boolean;
  ignoreWhitespace: boolean;
  diffsByFile: Record<string, FileDiff | null>;
  comments: ReviewComment[];
  fileStates: FileReviewState[];
  prNumber: number | null;
  // selections
  selectedCommentIds: number[];
  selectedFilePaths: string[];
  selectedHunkKeys: string[]; // "file::header"
  toast: { kind: 'info' | 'success' | 'error'; message: string } | null;
}

type Action =
  | { type: 'view'; view: View }
  | { type: 'setRepo'; repo: Repository | null }
  | { type: 'setSession'; session: ReviewSession | null }
  | { type: 'setStatus'; status: RepoStatus | null }
  | { type: 'setSelectedFile'; filePath: string | null }
  | { type: 'setDiffMode'; mode: 'unified' | 'split' }
  | { type: 'setDiffStaged'; staged: boolean }
  | { type: 'setIgnoreWhitespace'; value: boolean }
  | { type: 'setFileDiff'; filePath: string; diff: FileDiff | null }
  | { type: 'setComments'; comments: ReviewComment[] }
  | { type: 'setFileStates'; states: FileReviewState[] }
  | { type: 'setPrNumber'; n: number | null }
  | { type: 'toggleCommentSelection'; id: number; on?: boolean }
  | { type: 'toggleFileSelection'; path: string; on?: boolean }
  | { type: 'toggleHunkSelection'; key: string; on?: boolean }
  | { type: 'clearSelections' }
  | { type: 'toast'; toast: AppState['toast'] };

const initial: AppState = {
  view: 'picker',
  repo: null,
  session: null,
  status: null,
  selectedFile: null,
  files: [],
  diffMode: 'unified',
  diffStaged: false,
  ignoreWhitespace: false,
  diffsByFile: {},
  comments: [],
  fileStates: [],
  prNumber: null,
  selectedCommentIds: [],
  selectedFilePaths: [],
  selectedHunkKeys: [],
  toast: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'view':
      return { ...state, view: action.view };
    case 'setRepo':
      return { ...state, repo: action.repo };
    case 'setSession':
      return { ...state, session: action.session };
    case 'setStatus':
      return { ...state, status: action.status, files: action.status?.files ?? [] };
    case 'setSelectedFile':
      return { ...state, selectedFile: action.filePath };
    case 'setDiffMode':
      return { ...state, diffMode: action.mode };
    case 'setDiffStaged':
      return { ...state, diffStaged: action.staged, diffsByFile: {} };
    case 'setIgnoreWhitespace':
      return { ...state, ignoreWhitespace: action.value, diffsByFile: {} };
    case 'setFileDiff':
      return { ...state, diffsByFile: { ...state.diffsByFile, [action.filePath]: action.diff } };
    case 'setComments':
      return { ...state, comments: action.comments };
    case 'setFileStates':
      return { ...state, fileStates: action.states };
    case 'setPrNumber':
      return { ...state, prNumber: action.n };
    case 'toggleCommentSelection': {
      const has = state.selectedCommentIds.includes(action.id);
      const on = action.on ?? !has;
      return {
        ...state,
        selectedCommentIds: on
          ? Array.from(new Set([...state.selectedCommentIds, action.id]))
          : state.selectedCommentIds.filter((x) => x !== action.id),
      };
    }
    case 'toggleFileSelection': {
      const has = state.selectedFilePaths.includes(action.path);
      const on = action.on ?? !has;
      return {
        ...state,
        selectedFilePaths: on
          ? Array.from(new Set([...state.selectedFilePaths, action.path]))
          : state.selectedFilePaths.filter((x) => x !== action.path),
      };
    }
    case 'toggleHunkSelection': {
      const has = state.selectedHunkKeys.includes(action.key);
      const on = action.on ?? !has;
      return {
        ...state,
        selectedHunkKeys: on
          ? Array.from(new Set([...state.selectedHunkKeys, action.key]))
          : state.selectedHunkKeys.filter((x) => x !== action.key),
      };
    }
    case 'clearSelections':
      return { ...state, selectedCommentIds: [], selectedFilePaths: [], selectedHunkKeys: [] };
    case 'toast':
      return { ...state, toast: action.toast };
    default:
      return state;
  }
}

interface Ctx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  refresh: () => Promise<void>;
  loadDiff: (filePath: string) => Promise<void>;
  loadComments: () => Promise<void>;
  loadFileStates: () => Promise<void>;
  toast: (kind: 'info' | 'success' | 'error', message: string) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppContext missing');
  return c;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  const toast = useCallback((kind: 'info' | 'success' | 'error', message: string) => {
    dispatch({ type: 'toast', toast: { kind, message } });
    setTimeout(() => dispatch({ type: 'toast', toast: null }), 3200);
  }, []);

  const refresh = useCallback(async () => {
    const s = stateRef.current;
    if (!s.repo) return;
    try {
      const status = await api.status(s.repo.id);
      dispatch({ type: 'setStatus', status });
      const session = s.session ?? (await api.ensureLocalSession(s.repo.id));
      if (!s.session) dispatch({ type: 'setSession', session });
      // Reload diff for selected file
      if (s.selectedFile) {
        const diff = await api.fileDiff(s.repo.id, s.selectedFile, {
          staged: s.diffStaged,
          ignoreWhitespace: s.ignoreWhitespace,
          includeUntracked: !s.diffStaged,
        });
        dispatch({ type: 'setFileDiff', filePath: s.selectedFile, diff });
      }
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }, [toast]);

  const loadDiff = useCallback(
    async (filePath: string) => {
      const s = stateRef.current;
      if (!s.repo) return;
      try {
        const diff = await api.fileDiff(s.repo.id, filePath, {
          staged: s.diffStaged,
          ignoreWhitespace: s.ignoreWhitespace,
          includeUntracked: !s.diffStaged,
        });
        dispatch({ type: 'setFileDiff', filePath, diff });
        // mark viewed
        if (s.session) {
          const existing = s.fileStates.find((fs) => fs.file_path === filePath);
          if (!existing || existing.status === 'unviewed') {
            await api.setFileState(s.session.id, filePath, 'viewed');
            const states = await api.getFileStates(s.session.id);
            dispatch({ type: 'setFileStates', states });
          }
        }
      } catch (e) {
        toast('error', (e as Error).message);
      }
    },
    [toast],
  );

  const loadComments = useCallback(async () => {
    const s = stateRef.current;
    if (!s.session) return;
    const comments = await api.listComments(s.session.id);
    dispatch({ type: 'setComments', comments });
  }, []);

  const loadFileStates = useCallback(async () => {
    const s = stateRef.current;
    if (!s.session) return;
    const states = await api.getFileStates(s.session.id);
    dispatch({ type: 'setFileStates', states });
  }, []);

  useEffect(() => {
    if (state.repo && state.session) {
      void loadComments();
      void loadFileStates();
    }
  }, [state.repo, state.session, loadComments, loadFileStates]);

  const value = useMemo<Ctx>(
    () => ({ state, dispatch, refresh, loadDiff, loadComments, loadFileStates, toast }),
    [state, refresh, loadDiff, loadComments, loadFileStates, toast],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
