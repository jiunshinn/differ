import React from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import { cn } from '../utils/cn';
import type { ChangedFile, WorkingTreeGroup } from '@shared/types';

const GROUP_TITLES: Record<WorkingTreeGroup, string> = {
  conflicted: 'Conflicted',
  unstaged: 'Unstaged',
  staged: 'Staged',
  untracked: 'Untracked',
};

export default function ChangedFilesPanel() {
  const { state, dispatch, loadDiff, refresh, toast } = useApp();
  const files = state.files;
  const groups: WorkingTreeGroup[] = ['conflicted', 'staged', 'unstaged', 'untracked'];
  const byGroup = new Map<WorkingTreeGroup, ChangedFile[]>();
  for (const g of groups) byGroup.set(g, []);
  for (const f of files) byGroup.get(f.group)!.push(f);

  const repoId = state.repo!.id;

  const onClickFile = async (f: ChangedFile) => {
    dispatch({ type: 'setSelectedFile', filePath: f.path });
    dispatch({ type: 'setDiffStaged', staged: f.group === 'staged' });
    await loadDiff(f.path);
  };

  const stageFile = async (f: ChangedFile) => {
    try {
      await api.stageFile(repoId, f.path);
      await refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const unstageFile = async (f: ChangedFile) => {
    try {
      await api.unstageFile(repoId, f.path);
      await refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const stageAll = async (group: WorkingTreeGroup) => {
    for (const f of byGroup.get(group) ?? []) {
      try {
        await api.stageFile(repoId, f.path);
      } catch (e) {
        toast('error', (e as Error).message);
      }
    }
    await refresh();
  };
  const unstageAll = async () => {
    for (const f of byGroup.get('staged') ?? []) {
      try {
        await api.unstageFile(repoId, f.path);
      } catch (e) {
        toast('error', (e as Error).message);
      }
    }
    await refresh();
  };

  const fileStateMap = new Map(state.fileStates.map((s) => [s.file_path, s.status] as const));

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {groups.map((g) => {
        const list = byGroup.get(g)!;
        if (!list.length) return null;
        return (
          <div key={g}>
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-text-muted flex items-center justify-between sticky top-0 bg-bg-panel z-10 border-b border-border-subtle">
              <span>
                {GROUP_TITLES[g]} <span className="text-text-muted">({list.length})</span>
              </span>
              {g === 'unstaged' || g === 'untracked' ? (
                <button className="btn-ghost py-0 px-1 text-xs" onClick={() => void stageAll(g)}>
                  Stage all
                </button>
              ) : g === 'staged' ? (
                <button className="btn-ghost py-0 px-1 text-xs" onClick={() => void unstageAll()}>
                  Unstage all
                </button>
              ) : null}
            </div>
            <ul>
              {list.map((f) => {
                const isSelected = state.selectedFile === f.path && (state.diffStaged === (f.group === 'staged'));
                const stateLabel = fileStateMap.get(f.path);
                return (
                  <li
                    key={`${g}::${f.path}`}
                    className={cn(
                      'group px-2 py-1 cursor-pointer flex items-center gap-2 text-sm',
                      isSelected ? 'bg-bg-hover' : 'hover:bg-bg-subtle',
                    )}
                    onClick={() => void onClickFile(f)}
                  >
                    <StatusBadge file={f} />
                    <span className="truncate flex-1" title={f.path}>
                      {f.renamed && f.oldPath && (
                        <span className="text-text-muted">{f.oldPath} → </span>
                      )}
                      {f.path}
                    </span>
                    {stateLabel === 'reviewed' && <span className="text-success text-xs">✓</span>}
                    {g !== 'conflicted' && (
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                        {g === 'staged' ? (
                          <button
                            className="btn-ghost py-0 px-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void unstageFile(f);
                            }}
                          >
                            −
                          </button>
                        ) : (
                          <button
                            className="btn-ghost py-0 px-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void stageFile(f);
                            }}
                          >
                            +
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {!files.length && (
        <div className="p-4 text-sm text-text-muted">No changes. Working tree is clean.</div>
      )}
    </div>
  );
}

function StatusBadge({ file }: { file: ChangedFile }) {
  const code = file.group === 'staged' ? file.indexStatus : file.worktreeStatus;
  const label = labelFor(code, file.group);
  const color = colorFor(code);
  return (
    <span
      className={cn('w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold rounded', color)}
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
function colorFor(code: string): string {
  switch (code) {
    case 'M':
      return 'bg-amber-500/20 text-amber-300';
    case 'A':
      return 'bg-emerald-500/20 text-emerald-300';
    case 'D':
      return 'bg-red-500/20 text-red-300';
    case 'R':
      return 'bg-blue-500/20 text-blue-300';
    case '?':
      return 'bg-purple-500/20 text-purple-300';
    default:
      return 'bg-bg-subtle text-text-muted';
  }
}
