import React, { useMemo } from 'react';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';
import { useStageFileMutation, useUnstageFileMutation } from '../query/hooks';
import type { ChangedFile, WorkingTreeGroup } from '@shared/types';

const GROUP_TITLES: Record<WorkingTreeGroup, string> = {
  conflicted: 'Conflicted',
  unstaged: 'Unstaged',
  staged: 'Staged',
  untracked: 'Untracked',
};

const GROUP_ORDER: WorkingTreeGroup[] = ['conflicted', 'staged', 'unstaged', 'untracked'];

export default function ChangedFilesPanel() {
  const { state, dispatch, loadDiff, refresh, toast, logActivity } = useApp();
  const filter = state.fileFilter.trim().toLowerCase();
  const files = useMemo(
    () => (filter ? state.files.filter((f) => f.path.toLowerCase().includes(filter)) : state.files),
    [state.files, filter],
  );

  const byGroup = new Map<WorkingTreeGroup, ChangedFile[]>();
  for (const g of GROUP_ORDER) byGroup.set(g, []);
  for (const f of files) byGroup.get(f.group)!.push(f);

  const repoId = state.repo?.id ?? null;
  const stageFileMutation = useStageFileMutation(repoId);
  const unstageFileMutation = useUnstageFileMutation(repoId);

  const onClickFile = async (f: ChangedFile) => {
    dispatch({ type: 'setSelectedFile', filePath: f.path });
    dispatch({ type: 'setDiffStaged', staged: f.group === 'staged' });
    await loadDiff(f.path);
  };

  const stageFile = async (f: ChangedFile) => {
    try {
      await stageFileMutation.mutateAsync(f.path);
      logActivity({ kind: 'file_staged', message: 'Staged', detail: f.path });
      await refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const unstageFile = async (f: ChangedFile) => {
    try {
      await unstageFileMutation.mutateAsync(f.path);
      logActivity({ kind: 'file_unstaged', message: 'Unstaged', detail: f.path });
      await refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const stageAll = async (group: WorkingTreeGroup) => {
    for (const f of byGroup.get(group) ?? []) {
      try {
        await stageFileMutation.mutateAsync(f.path);
      } catch (e) {
        toast('error', (e as Error).message);
      }
    }
    logActivity({ kind: 'file_staged', message: `Staged all ${GROUP_TITLES[group].toLowerCase()}` });
    await refresh();
  };
  const unstageAll = async () => {
    for (const f of byGroup.get('staged') ?? []) {
      try {
        await unstageFileMutation.mutateAsync(f.path);
      } catch (e) {
        toast('error', (e as Error).message);
      }
    }
    logActivity({ kind: 'file_unstaged', message: 'Unstaged all' });
    await refresh();
  };

  const fileStateMap = new Map(state.fileStates.map((s) => [s.file_path, s.status] as const));

  return (
    <aside className="flex-1 min-h-0 overflow-auto p-3.5">
      <input
        className="input"
        aria-label="Filter files"
        placeholder="Filter files or comments"
        value={state.fileFilter}
        onChange={(e) => dispatch({ type: 'setFileFilter', value: e.target.value })}
      />
      <div className="mt-3.5 grid gap-3.5">
        {GROUP_ORDER.map((g) => {
          const list = byGroup.get(g)!;
          if (!list.length) return null;
          return (
            <section key={g}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="section-label">
                  {GROUP_TITLES[g]}{' '}
                  <span className="text-text-muted font-mono normal-case tracking-normal">({list.length})</span>
                </div>
                {g === 'unstaged' || g === 'untracked' ? (
                  <button className="btn-ghost text-[11px] h-6 px-2" onClick={() => void stageAll(g)}>
                    Stage all
                  </button>
                ) : g === 'staged' ? (
                  <button className="btn-ghost text-[11px] h-6 px-2" onClick={() => void unstageAll()}>
                    Unstage all
                  </button>
                ) : null}
              </div>
              <div className="grid gap-[3px]">
                {list.map((f) => {
                  const isSelected =
                    state.selectedFile === f.path && state.diffStaged === (f.group === 'staged');
                  const stateLabel = fileStateMap.get(f.path);
                  return (
                    <div
                      key={`${g}::${f.path}`}
                      className={cn(
                        'group grid grid-cols-[20px_minmax(0,1fr)_auto] gap-2 items-center px-2 py-1.5 rounded-lg text-sm cursor-pointer min-w-0',
                        isSelected
                          ? 'bg-bg-panel border border-border shadow-card'
                          : 'border border-transparent hover:bg-bg-subtle',
                      )}
                      onClick={() => void onClickFile(f)}
                    >
                      <StatusBadge file={f} />
                      <span className="truncate" title={f.path}>
                        {f.renamed && f.oldPath && (
                          <span className="text-text-muted">{f.oldPath} → </span>
                        )}
                        {f.path}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {stateLabel === 'reviewed' && (
                          <span className="text-success text-xs" title="Reviewed">
                            ✓
                          </span>
                        )}
                        {g !== 'conflicted' && (
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {g === 'staged' ? (
                              <button
                                className="btn-ghost h-6 w-6 p-0 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void unstageFile(f);
                                }}
                                title="Unstage"
                              >
                                −
                              </button>
                            ) : (
                              <button
                                className="btn-ghost h-6 w-6 p-0 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void stageFile(f);
                                }}
                                title="Stage"
                              >
                                +
                              </button>
                            )}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!files.length && (
          <div className="p-4 text-sm text-text-muted">
            {filter ? 'No files match your filter.' : 'No changes. Working tree is clean.'}
          </div>
        )}
      </div>
    </aside>
  );
}

function StatusBadge({ file }: { file: ChangedFile }) {
  const code = file.group === 'staged' ? file.indexStatus : file.worktreeStatus;
  const label = labelFor(code, file.group);
  const color = colorFor(code, file.group);
  return (
    <span
      className={cn('w-5 text-center font-mono text-xs font-semibold', color)}
      title={`index:${file.indexStatus} worktree:${file.worktreeStatus}`}
    >
      {label}
    </span>
  );
}
function labelFor(code: string, group: WorkingTreeGroup): string {
  if (group === 'untracked') return 'U';
  if (group === 'conflicted') return '!';
  switch (code) {
    case 'M':
      return 'M';
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    case 'C':
      return 'C';
    case '?':
      return 'U';
    default:
      return code || '·';
  }
}
function colorFor(code: string, group: WorkingTreeGroup): string {
  if (group === 'conflicted') return 'text-danger';
  if (group === 'untracked') return 'text-accent';
  switch (code) {
    case 'M':
      return 'text-warn';
    case 'A':
      return 'text-success';
    case 'D':
      return 'text-danger';
    case 'R':
      return 'text-accent';
    case 'C':
      return 'text-accent';
    case '?':
      return 'text-accent';
    default:
      return 'text-text-muted';
  }
}
