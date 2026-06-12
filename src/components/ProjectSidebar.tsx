import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import { useRecentReposQuery } from '../query/hooks';
import { queryKeys } from '../query/keys';
import { cn } from '../utils/cn';
import type { Repository } from '@shared/types';

const STORAGE_KEY = 'differ:projectSidebar:collapsed';
const DND_MIME = 'application/x-differ-repo-id';
const EMPTY_REPOS: Repository[] = [];

function initials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!cleaned) return '·';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

type DropPos = 'before' | 'after';

export default function ProjectSidebar() {
  const { state, dispatch, refresh, toast } = useApp();
  const queryClient = useQueryClient();
  const recentQuery = useRecentReposQuery();
  const recent = recentQuery.data ?? EMPTY_REPOS;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; pos: DropPos } | null>(null);
  const dragIdRef = useRef<number | null>(null);
  // Monotonic token guarding repo switches: clicking A then B fires two
  // concurrent openRepo IPC calls; whichever resolves LAST must not clobber the
  // newer selection. Each switch captures the token and bails if a newer one
  // started while its IPC was in flight.
  const switchTokenRef = useRef(0);
  const recentError = recentQuery.error instanceof Error ? recentQuery.error.message : null;

  useEffect(() => {
    if (recentError) toast('error', recentError);
  }, [recentError, toast]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const { pinned, unpinned } = useMemo(() => {
    const p: Repository[] = [];
    const u: Repository[] = [];
    for (const r of recent) (r.pinned ? p : u).push(r);
    return { pinned: p, unpinned: u };
  }, [recent]);

  const switchTo = async (repo: Repository) => {
    if (state.repo?.id === repo.id) return;
    const token = ++switchTokenRef.current;
    try {
      const r = await api.openRepo(repo.path);
      // A newer switch started while openRepo was in flight — drop this result.
      if (token !== switchTokenRef.current) return;
      dispatch({ type: 'setRepo', repo: r });
      dispatch({ type: 'setSession', session: null });
      dispatch({ type: 'setStatus', status: null });
      dispatch({ type: 'setSelectedFile', filePath: null });
      dispatch({ type: 'setPrNumber', n: null });
      dispatch({ type: 'view', view: 'local' });
      await refresh();
      if (token !== switchTokenRef.current) return;
      await recentQuery.refetch();
    } catch (e) {
      if (token !== switchTokenRef.current) return;
      toast('error', (e as Error).message);
    }
  };

  const pick = async () => {
    const token = ++switchTokenRef.current;
    try {
      const r = await api.pickRepo();
      if (!r) return;
      if (token !== switchTokenRef.current) return;
      dispatch({ type: 'setRepo', repo: r });
      dispatch({ type: 'setSession', session: null });
      dispatch({ type: 'setStatus', status: null });
      dispatch({ type: 'setSelectedFile', filePath: null });
      dispatch({ type: 'setPrNumber', n: null });
      dispatch({ type: 'view', view: 'local' });
      await refresh();
      if (token !== switchTokenRef.current) return;
      await recentQuery.refetch();
    } catch (e) {
      if (token !== switchTokenRef.current) return;
      toast('error', (e as Error).message);
    }
  };

  const togglePin = async (repo: Repository) => {
    const wantPinned = !repo.pinned;
    queryClient.setQueryData<Repository[]>(queryKeys.repo.recent(), (prev = EMPTY_REPOS) =>
      prev.map((r) => (r.id === repo.id ? { ...r, pinned: wantPinned ? 1 : 0 } : r)),
    );
    try {
      await api.setRepoPinned(repo.id, wantPinned);
      await recentQuery.refetch();
    } catch (e) {
      toast('error', (e as Error).message);
      await recentQuery.refetch();
    }
  };

  const persistOrder = async (orderedAll: Repository[]) => {
    try {
      await api.reorderRepos(orderedAll.map((r) => r.id));
      await recentQuery.refetch();
    } catch (e) {
      toast('error', (e as Error).message);
      await recentQuery.refetch();
    }
  };

  const handleDrop = (target: Repository) => {
    const fromId = dragIdRef.current;
    const pos = dropTarget?.pos ?? 'before';
    setDragId(null);
    setDropTarget(null);
    dragIdRef.current = null;
    if (fromId == null || fromId === target.id) return;
    const from = recent.find((r) => r.id === fromId);
    if (!from) return;
    // Reordering crosses pin boundary => also flip the pin state to match destination section.
    const willPin = !!target.pinned;
    const sectionKey = (r: Repository) => (willPin ? !!r.pinned : !r.pinned);
    const section = recent.filter(sectionKey);
    const other = recent.filter((r) => !sectionKey(r));
    const without = section.filter((r) => r.id !== fromId);
    const targetIdx = without.findIndex((r) => r.id === target.id);
    const insertAt = pos === 'before' ? targetIdx : targetIdx + 1;
    const movedRepo: Repository = { ...from, pinned: willPin ? 1 : 0 };
    without.splice(insertAt, 0, movedRepo);
    const nextAll = willPin ? [...without, ...other] : [...other, ...without];
    queryClient.setQueryData(queryKeys.repo.recent(), nextAll);
    if (from.pinned !== movedRepo.pinned) {
      void api.setRepoPinned(from.id, willPin).catch(() => void recentQuery.refetch());
    }
    void persistOrder(nextAll);
  };

  const handleDragOver = (e: React.DragEvent, target: Repository) => {
    if (dragIdRef.current == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos: DropPos = collapsed
      ? e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
      : e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    setDropTarget({ id: target.id, pos });
  };

  const handleDragStart = (e: React.DragEvent, repo: Repository) => {
    dragIdRef.current = repo.id;
    setDragId(repo.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DND_MIME, String(repo.id));
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDragId(null);
    setDropTarget(null);
  };

  const width = collapsed ? 'w-[56px]' : 'w-[220px]';

  const renderItem = (r: Repository) => {
    const active = state.repo?.id === r.id;
    const dragging = dragId === r.id;
    const isTarget = dropTarget?.id === r.id;
    const label = r.github_owner && r.github_repo ? `${r.github_owner}/${r.github_repo}` : r.name;

    if (collapsed) {
      return (
        <li
          key={r.id}
          draggable
          onDragStart={(e) => handleDragStart(e, r)}
          onDragOver={(e) => handleDragOver(e, r)}
          onDragLeave={() => setDropTarget((t) => (t?.id === r.id ? null : t))}
          onDrop={() => handleDrop(r)}
          onDragEnd={handleDragEnd}
          className={cn(
            'relative',
            dragging && 'opacity-40',
            isTarget && dropTarget?.pos === 'before' && 'before:absolute before:left-1 before:right-1 before:-top-[3px] before:h-[2px] before:bg-accent before:rounded',
            isTarget && dropTarget?.pos === 'after' && 'after:absolute after:left-1 after:right-1 after:-bottom-[3px] after:h-[2px] after:bg-accent after:rounded',
          )}
        >
          <button
            onClick={() => void switchTo(r)}
            title={`${label}${r.pinned ? ' (pinned)' : ''}\n${r.path}`}
            className={cn(
              'w-9 h-9 rounded-lg grid place-items-center text-xs font-semibold tracking-wide border transition-colors relative',
              active
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-panel text-text-secondary border-border hover:border-text-primary hover:text-text-primary',
            )}
          >
            {initials(r.name)}
            {!!r.pinned && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent border border-bg grid place-items-center text-[8px] text-white leading-none">
                ★
              </span>
            )}
          </button>
        </li>
      );
    }

    return (
      <li
        key={r.id}
        draggable
        onDragStart={(e) => handleDragStart(e, r)}
        onDragOver={(e) => handleDragOver(e, r)}
        onDragLeave={() => setDropTarget((t) => (t?.id === r.id ? null : t))}
        onDrop={() => handleDrop(r)}
        onDragEnd={handleDragEnd}
        className={cn(
          'group relative',
          dragging && 'opacity-40',
          isTarget && dropTarget?.pos === 'before' && 'before:absolute before:left-1 before:right-1 before:-top-[2px] before:h-[2px] before:bg-accent before:rounded',
          isTarget && dropTarget?.pos === 'after' && 'after:absolute after:left-1 after:right-1 after:-bottom-[2px] after:h-[2px] after:bg-accent after:rounded',
        )}
      >
        <div
          className={cn(
            'w-full h-9 px-2 rounded-lg flex items-center gap-2 text-sm border transition-colors',
            active
              ? 'bg-bg-panel border-border text-text-primary'
              : 'border-transparent text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
          )}
        >
          <button
            onClick={() => void switchTo(r)}
            title={r.path}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              void togglePin(r);
            }}
            title={r.pinned ? 'Unpin' : 'Pin to top'}
            className={cn(
              'w-5 h-5 grid place-items-center text-xs rounded transition-opacity shrink-0',
              r.pinned
                ? 'text-accent opacity-100'
                : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary',
            )}
            aria-label={r.pinned ? 'Unpin project' : 'Pin project'}
          >
            {r.pinned ? '★' : '☆'}
          </button>
        </div>
      </li>
    );
  };

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
        )}
      </div>

      <div className="flex-1 overflow-auto py-2">
        {pinned.length > 0 && (
          <>
            {!collapsed && (
              <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.08em] text-text-muted font-semibold">
                Pinned
              </div>
            )}
            <ul className={cn('flex flex-col', collapsed ? 'items-center gap-1.5 px-0' : 'gap-0.5 px-2')}>
              {pinned.map(renderItem)}
            </ul>
            {collapsed ? (
              <div className="my-2 mx-auto w-6 border-t border-border" />
            ) : (
              <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-[0.08em] text-text-muted font-semibold">
                Recent
              </div>
            )}
          </>
        )}

        <ul className={cn('flex flex-col', collapsed ? 'items-center gap-1.5 px-0' : 'gap-0.5 px-2')}>
          {unpinned.map(renderItem)}

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
