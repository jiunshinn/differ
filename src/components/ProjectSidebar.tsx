import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';
import type { Repository } from '@shared/types';

const STORAGE_KEY = 'differ:projectSidebar:collapsed';

function initials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!cleaned) return '·';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function ProjectSidebar() {
  const { state, dispatch, refresh, toast } = useApp();
  const [recent, setRecent] = useState<Repository[]>([]);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const load = async () => {
    try {
      const list = await api.recentRepos();
      setRecent(list);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (state.repo) void load();
  }, [state.repo?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const open = async (repo: Repository) => {
    if (state.repo?.id === repo.id) return;
    try {
      const r = await api.openRepo(repo.path);
      dispatch({ type: 'setRepo', repo: r });
      dispatch({ type: 'setSession', session: null });
      dispatch({ type: 'setStatus', status: null });
      dispatch({ type: 'setSelectedFile', filePath: null });
      dispatch({ type: 'setPrNumber', n: null });
      dispatch({ type: 'clearSelections' });
      dispatch({ type: 'view', view: 'local' });
      await refresh();
      await load();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const pick = async () => {
    try {
      const r = await api.pickRepo();
      if (!r) return;
      dispatch({ type: 'setRepo', repo: r });
      dispatch({ type: 'setSession', session: null });
      dispatch({ type: 'setStatus', status: null });
      dispatch({ type: 'setSelectedFile', filePath: null });
      dispatch({ type: 'setPrNumber', n: null });
      dispatch({ type: 'clearSelections' });
      dispatch({ type: 'view', view: 'local' });
      await refresh();
      await load();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const width = collapsed ? 'w-[56px]' : 'w-[220px]';

  return (
    <aside
      className={cn(
        'h-full flex flex-col border-r border-border bg-bg shrink-0 transition-[width] duration-150',
        width,
      )}
    >
      <div
        className={cn(
          'h-12 flex items-center border-b border-border shrink-0',
          collapsed ? 'justify-center px-0' : 'justify-between px-3',
        )}
      >
        {collapsed ? (
          <button
            className="w-7 h-7 rounded-md border border-text-primary text-text-primary grid place-items-center font-mono text-[11px] leading-none"
            onClick={() => dispatch({ type: 'view', view: 'picker' })}
            title="Differ"
          >
            DF
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <button
                className="w-6 h-6 rounded-md border border-text-primary text-text-primary grid place-items-center font-mono text-[11px] leading-none shrink-0"
                onClick={() => dispatch({ type: 'view', view: 'picker' })}
                title="Open repository picker"
              >
                DF
              </button>
              <span className="section-label truncate">Projects</span>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto py-2">
        <ul className={cn('flex flex-col', collapsed ? 'items-center gap-1.5 px-0' : 'gap-0.5 px-2')}>
          {recent.map((r) => {
            const active = state.repo?.id === r.id;
            const label = r.github_owner && r.github_repo ? `${r.github_owner}/${r.github_repo}` : r.name;
            return (
              <li key={r.id} className={collapsed ? '' : 'w-full'}>
                {collapsed ? (
                  <button
                    onClick={() => void open(r)}
                    title={`${label}\n${r.path}`}
                    className={cn(
                      'w-9 h-9 rounded-lg grid place-items-center text-xs font-semibold tracking-wide border transition-colors',
                      active
                        ? 'bg-accent text-white border-accent'
                        : 'bg-bg-panel text-text-secondary border-border hover:border-text-primary hover:text-text-primary',
                    )}
                  >
                    {initials(r.name)}
                  </button>
                ) : (
                  <button
                    onClick={() => void open(r)}
                    title={r.path}
                    className={cn(
                      'w-full h-9 px-2 rounded-lg flex items-center gap-2 text-sm text-left border transition-colors',
                      active
                        ? 'bg-bg-panel border-border text-text-primary'
                        : 'border-transparent text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
                    )}
                  >
                    <span
                      className={cn(
                        'w-6 h-6 rounded-md grid place-items-center text-[10px] font-semibold border shrink-0',
                        active
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-panel text-text-muted border-border',
                      )}
                    >
                      {initials(r.name)}
                    </span>
                    <span className="truncate font-medium">{label}</span>
                  </button>
                )}
              </li>
            );
          })}

          <li className={collapsed ? 'mt-1' : 'w-full mt-1'}>
            {collapsed ? (
              <button
                onClick={() => void pick()}
                title="Open repository…"
                className="w-9 h-9 rounded-lg grid place-items-center border border-dashed border-border text-text-muted hover:text-text-primary hover:border-text-primary transition-colors"
              >
                +
              </button>
            ) : (
              <button
                onClick={() => void pick()}
                className="w-full h-9 px-2 rounded-lg flex items-center gap-2 text-sm border border-dashed border-border text-text-muted hover:text-text-primary hover:border-text-primary transition-colors"
              >
                <span className="w-6 h-6 grid place-items-center shrink-0">+</span>
                <span className="truncate">Open repository…</span>
              </button>
            )}
          </li>
        </ul>
      </div>

      <div className={cn('border-t border-border p-2 flex', collapsed ? 'justify-center' : 'justify-end')}>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="btn-icon h-7 w-7"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
    </aside>
  );
}
