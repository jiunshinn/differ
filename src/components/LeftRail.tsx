import React from 'react';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';
import CommitBar from './CommitBar';

export default function LeftRail() {
  const { state, dispatch } = useApp();
  const repo = state.repo;
  const status = state.status;

  const counts = {
    changes: state.files.length,
    comments: state.comments.filter((c) => c.status === 'open').length,
    prs: state.prNumber ? 1 : 0,
  };

  const conflictCount = state.files.filter((f) => f.group === 'conflicted').length;

  const navItems: { id: 'local' | 'history' | 'pr-list' | 'context'; label: string; count: number | null }[] = [
    { id: 'local', label: 'Changes', count: counts.changes },
    { id: 'history', label: 'History', count: conflictCount || null },
    { id: 'pr-list', label: 'Pull requests', count: counts.prs || null },
    { id: 'context', label: 'Context', count: state.selectedCommentIds.length + state.selectedHunkKeys.length + state.selectedFilePaths.length },
  ];

  return (
    <aside className="overflow-auto border-r border-border bg-bg p-3.5 flex flex-col gap-4">
      {repo && (
        <section className="panel-card p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="font-semibold tracking-tight truncate" title={repo.path}>
              {repo.github_owner && repo.github_repo
                ? `${repo.github_owner}/${repo.github_repo}`
                : repo.name}
            </div>
            {repo.github_owner && (
              <span className="chip">GH</span>
            )}
          </div>
          <div className="text-text-muted font-mono text-xs leading-5">
            {repo.path}
            {status?.branch && <div>branch {status.branch}</div>}
            {status && (
              <div>
                {status.ahead === 0 && status.behind === 0
                  ? 'in sync'
                  : `${status.ahead ? `ahead ${status.ahead}` : ''}${status.ahead && status.behind ? ' · ' : ''}${status.behind ? `behind ${status.behind}` : ''}`}
              </div>
            )}
          </div>
        </section>
      )}

      <nav>
        <div className="section-label mb-2">Workspace</div>
        <div className="grid gap-1">
          {navItems.map((item) => {
            const active = state.view === item.id || (item.id === 'pr-list' && state.view === 'pr-detail');
            return (
              <button
                key={item.id}
                onClick={() => dispatch({ type: 'view', view: item.id })}
                className={cn(
                  'h-9 px-2.5 rounded-lg flex items-center justify-between text-sm font-medium',
                  active
                    ? 'bg-bg-panel border border-border'
                    : 'border border-transparent hover:bg-bg-subtle',
                )}
              >
                <span>{item.label}</span>
                {item.count != null && item.count > 0 && (
                  <span className="text-xs text-text-muted font-mono tabular-nums">{item.count}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {state.session && state.view !== 'pr-detail' && state.view !== 'context' && (
        <CommitBar />
      )}
    </aside>
  );
}
