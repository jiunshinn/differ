import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '../api';
import { queryKeys, type DiffQueryOptions } from './keys';
import type {
  BranchInfo,
  ChangedFile,
  CommentLabel,
  CommentTargetKind,
  ContextExtractionInput,
  ContextExtractionResult,
  FileDiff,
  FileReviewStatus,
  GithubIssueStateFilter,
  GithubPullRequestStateFilter,
  GithubSubmitReviewInput,
  RepoStatus,
  ReviewComment,
  ReviewSession,
  TreeEntry,
} from '@shared/types';

export function repoStatusQueryOptions(repoId: number) {
  return {
    queryKey: queryKeys.repo.status(repoId),
    queryFn: () => api.status(repoId),
  };
}

export function localSessionQueryOptions(repoId: number) {
  return {
    queryKey: queryKeys.session.local(repoId),
    queryFn: () => api.ensureLocalSession(repoId),
  };
}

export function fileDiffQueryOptions(repoId: number, filePath: string, opts: DiffQueryOptions) {
  return {
    queryKey: queryKeys.diff.file(repoId, filePath, opts),
    queryFn: () =>
      api.fileDiff(repoId, filePath, {
        staged: opts.staged,
        ignoreWhitespace: opts.ignoreWhitespace,
        includeUntracked: opts.includeUntracked,
        base: opts.base,
        head: opts.head,
      }),
  };
}

export function commentsQueryOptions(sessionId: number) {
  return {
    queryKey: queryKeys.session.comments(sessionId),
    queryFn: () => api.listComments(sessionId),
  };
}

export function fileStatesQueryOptions(sessionId: number) {
  return {
    queryKey: queryKeys.session.fileStates(sessionId),
    queryFn: () => api.getFileStates(sessionId),
  };
}

export function invalidateRepoQueries(queryClient: QueryClient, repoId: number): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.repo.scope(repoId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.diff.repo(repoId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.github.repo(repoId) }),
  ]).then(() => undefined);
}

export function invalidateReviewQueries(queryClient: QueryClient, sessionId: number): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.session.comments(sessionId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.session.fileStates(sessionId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.session.detail(sessionId) }),
  ]).then(() => undefined);
}

export function useRepoStatusQuery(repoId: number | null) {
  return useQuery({
    queryKey: repoId == null ? [...queryKeys.repo.all(), 'status', 'none'] : queryKeys.repo.status(repoId),
    queryFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.status(repoId);
    },
    enabled: repoId != null,
  });
}

export function useRecentReposQuery() {
  return useQuery({
    queryKey: queryKeys.repo.recent(),
    queryFn: () => api.recentRepos(),
  });
}

export function useBranchesQuery(repoId: number | null, enabled = true) {
  return useQuery<BranchInfo[]>({
    queryKey: repoId == null ? [...queryKeys.repo.all(), 'branches', 'none'] : queryKeys.repo.branches(repoId),
    queryFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.branches(repoId);
    },
    enabled: enabled && repoId != null,
  });
}

export function useCommitsQuery(repoId: number | null, limit: number) {
  return useQuery({
    queryKey: repoId == null ? [...queryKeys.repo.all(), 'commits', 'none', limit] : queryKeys.repo.commits(repoId, limit),
    queryFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.commits(repoId, limit);
    },
    enabled: repoId != null,
  });
}

export function useTreeQuery(repoId: number | null, relDir: string, enabled = true) {
  return useQuery<TreeEntry[]>({
    queryKey: repoId == null ? [...queryKeys.repo.all(), 'tree', 'none', relDir] : queryKeys.repo.tree(repoId, relDir),
    queryFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.listTree(repoId, relDir);
    },
    enabled: enabled && repoId != null,
  });
}

export function useFileContentQuery(repoId: number | null, relPath: string | null) {
  return useQuery({
    queryKey:
      repoId == null || relPath == null
        ? [...queryKeys.repo.all(), 'file', 'none']
        : queryKeys.repo.file(repoId, relPath),
    queryFn: () => {
      if (repoId == null || relPath == null) throw new Error('File is not selected');
      return api.readFile(repoId, relPath);
    },
    enabled: repoId != null && relPath != null,
  });
}

export function useFileDiffQuery({
  repoId,
  filePath,
  staged,
  ignoreWhitespace,
  includeUntracked,
  base,
  head,
}: {
  repoId: number | null;
  filePath: string | null;
} & DiffQueryOptions) {
  const opts = {
    staged,
    ignoreWhitespace,
    includeUntracked,
    base,
    head,
  };
  return useQuery<FileDiff | null>({
    queryKey:
      repoId == null || filePath == null
        ? [...queryKeys.diff.all(), 'file', 'none']
        : queryKeys.diff.file(repoId, filePath, opts),
    queryFn: () => {
      if (repoId == null || filePath == null) throw new Error('File is not selected');
      return api.fileDiff(repoId, filePath, {
        staged,
        ignoreWhitespace,
        includeUntracked,
        base,
        head,
      });
    },
    enabled: repoId != null && filePath != null,
  });
}

export function useAllDiffQuery(repoId: number | null, opts: DiffQueryOptions, enabled = true) {
  return useQuery<FileDiff[]>({
    queryKey: repoId == null ? [...queryKeys.diff.all(), 'all', 'none'] : queryKeys.diff.allFiles(repoId, opts),
    queryFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.allDiff(repoId, {
        staged: opts.staged,
        ignoreWhitespace: opts.ignoreWhitespace,
        base: opts.base,
        head: opts.head,
      });
    },
    enabled: enabled && repoId != null,
  });
}

export function useCommentsQuery(sessionId: number | null) {
  return useQuery<ReviewComment[]>({
    queryKey:
      sessionId == null ? [...queryKeys.session.all(), 'comments', 'none'] : queryKeys.session.comments(sessionId),
    queryFn: () => {
      if (sessionId == null) throw new Error('Review session is not selected');
      return api.listComments(sessionId);
    },
    enabled: sessionId != null,
  });
}

export function useFileStatesQuery(sessionId: number | null) {
  return useQuery({
    queryKey:
      sessionId == null
        ? [...queryKeys.session.all(), 'file-states', 'none']
        : queryKeys.session.fileStates(sessionId),
    queryFn: () => {
      if (sessionId == null) throw new Error('Review session is not selected');
      return api.getFileStates(sessionId);
    },
    enabled: sessionId != null,
  });
}

export function useGithubAuthQuery() {
  return useQuery({
    queryKey: queryKeys.github.auth(),
    queryFn: () => api.ghAuthList(),
  });
}

export function useGithubPullRequestsQuery(
  repoId: number | null,
  state: GithubPullRequestStateFilter,
  enabled = true,
) {
  return useQuery({
    queryKey: repoId == null ? [...queryKeys.github.all(), 'prs', 'none', state] : queryKeys.github.prs(repoId, state),
    queryFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.ghPrList(repoId, state);
    },
    enabled: enabled && repoId != null,
  });
}

export function useGithubPullRequestDetailQuery(repoId: number | null, prNumber: number | null) {
  return useQuery({
    queryKey:
      repoId == null || prNumber == null
        ? [...queryKeys.github.all(), 'pr', 'none']
        : queryKeys.github.prDetail(repoId, prNumber),
    queryFn: () => {
      if (repoId == null || prNumber == null) throw new Error('Pull request is not selected');
      return api.ghPrDetail(repoId, prNumber);
    },
    enabled: repoId != null && prNumber != null,
  });
}

export function useGithubPullRequestChecksQuery(repoId: number | null, ref: string | null | undefined) {
  return useQuery({
    queryKey:
      repoId == null || !ref
        ? [...queryKeys.github.all(), 'checks', 'none']
        : queryKeys.github.prChecks(repoId, ref),
    queryFn: () => {
      if (repoId == null || !ref) throw new Error('Check ref is not selected');
      return api.ghPrChecks(repoId, ref);
    },
    enabled: repoId != null && !!ref,
  });
}

export function useGithubIssuesQuery(repoId: number | null, state: GithubIssueStateFilter, enabled = true) {
  return useQuery({
    queryKey:
      repoId == null ? [...queryKeys.github.all(), 'issues', 'none', state] : queryKeys.github.issues(repoId, state),
    queryFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.ghIssueList(repoId, state);
    },
    enabled: enabled && repoId != null,
  });
}

export function useGithubIssueDetailQuery(repoId: number | null, issueNumber: number | null) {
  return useQuery({
    queryKey:
      repoId == null || issueNumber == null
        ? [...queryKeys.github.all(), 'issue', 'none']
        : queryKeys.github.issueDetail(repoId, issueNumber),
    queryFn: () => {
      if (repoId == null || issueNumber == null) throw new Error('Issue is not selected');
      return api.ghIssueDetail(repoId, issueNumber);
    },
    enabled: repoId != null && issueNumber != null,
  });
}

export function useGithubReposQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.github.repos(),
    queryFn: () => api.ghListAllRepos(),
    enabled,
  });
}

export function useGithubOrgsQuery(accountId: number | null, enabled = true) {
  return useQuery({
    queryKey: accountId == null ? [...queryKeys.github.all(), 'orgs', 'none'] : queryKeys.github.orgs(accountId),
    queryFn: () => {
      if (accountId == null) throw new Error('GitHub account is not selected');
      return api.ghListMyOrgs(accountId);
    },
    enabled: enabled && accountId != null,
  });
}

export function useGithubOrgReposQuery(accountId: number | null, org: string | null, enabled = true) {
  return useQuery({
    queryKey:
      accountId == null || org == null
        ? [...queryKeys.github.all(), 'org-repos', 'none']
        : queryKeys.github.orgRepos(accountId, org),
    queryFn: () => {
      if (accountId == null || org == null) throw new Error('GitHub org is not selected');
      return api.ghListOrgRepos(accountId, org);
    },
    enabled: enabled && accountId != null && org != null,
  });
}

export function useContextPreviewQuery(input: ContextExtractionInput | null, enabled: boolean) {
  return useQuery<ContextExtractionResult>({
    queryKey: input == null ? [...queryKeys.session.all(), 'context-preview', 'none'] : queryKeys.session.contextPreview(input),
    queryFn: () => {
      if (input == null) throw new Error('Context input is not ready');
      return api.previewContext(input);
    },
    enabled: enabled && input != null,
    placeholderData: keepPreviousData,
  });
}

export function useStageFileMutation(repoId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filePath: string) => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.stageFile(repoId, filePath);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function useUnstageFileMutation(repoId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filePath: string) => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.unstageFile(repoId, filePath);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function useStageHunkMutation(repoId: number | null, filePath: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hunkHeader: string) => {
      if (repoId == null || filePath == null) throw new Error('File is not selected');
      return api.stageHunk(repoId, filePath, hunkHeader);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function useUnstageHunkMutation(repoId: number | null, filePath: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hunkHeader: string) => {
      if (repoId == null || filePath == null) throw new Error('File is not selected');
      return api.unstageHunk(repoId, filePath, hunkHeader);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function useRepoCommandMutation(
  repoId: number | null,
  command: (repoId: number) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (repoId == null) throw new Error('Repository is not selected');
      return command(repoId);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function useCommitMutation(repoId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.commit(repoId, message);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function useAmendMutation(repoId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string | null) => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.amend(repoId, message);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function useSetFileStateMutation(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ filePath, status }: { filePath: string; status: FileReviewStatus }) => {
      if (sessionId == null) throw new Error('Review session is not selected');
      return api.setFileState(sessionId, filePath, status);
    },
    onSuccess: () => {
      if (sessionId != null) return invalidateReviewQueries(queryClient, sessionId);
    },
  });
}

export function useCreateCommentMutation(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      file_path: string;
      target_kind: CommentTargetKind;
      diff_side: 'old' | 'new' | 'none';
      line_number: number | null;
      hunk_header: string | null;
      body: string;
      label: CommentLabel;
    }) => {
      if (sessionId == null) throw new Error('Review session is not selected');
      return api.createComment({ review_session_id: sessionId, ...input });
    },
    onSuccess: () => {
      if (sessionId != null) return invalidateReviewQueries(queryClient, sessionId);
    },
  });
}

export function useUpdateCommentMutation(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number;
      patch: Partial<{ body: string; label: CommentLabel; status: 'open' | 'resolved' }>;
    }) => api.updateComment(id, patch),
    onSuccess: () => {
      if (sessionId != null) return invalidateReviewQueries(queryClient, sessionId);
    },
  });
}

export function useDeleteCommentMutation(sessionId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteComment(id),
    onSuccess: () => {
      if (sessionId != null) return invalidateReviewQueries(queryClient, sessionId);
    },
  });
}

export function useSubmitReviewMutation(repoId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GithubSubmitReviewInput) => {
      if (repoId == null) throw new Error('Repository is not selected');
      return api.ghPrSubmitReview(repoId, input);
    },
    onSuccess: () => {
      if (repoId != null) return invalidateRepoQueries(queryClient, repoId);
    },
  });
}

export function readStatusFiles(status: RepoStatus | undefined | null): ChangedFile[] {
  return status?.files ?? [];
}

export function readCurrentSession(queryClient: QueryClient, session: ReviewSession | null): ReviewSession | null {
  if (!session) return null;
  return queryClient.getQueryData<ReviewSession>(queryKeys.session.detail(session.id)) ?? session;
}
