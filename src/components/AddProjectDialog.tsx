import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Folder, FolderGit2, GitBranch, Laptop, RefreshCw, Server } from 'lucide-react';
import { api } from '../api';
import { useRecentReposQuery } from '../query/hooks';
import { Badge, Button, Dialog, DialogContent, IconButton, Input, Segmented, Spinner, Tag } from '../ui';
import { cn } from '../utils/cn';
import type { Environment, FsBrowseListing, Repository } from '@shared/types';

interface Props {
  onClose: () => void;
  /**
   * 'repo' only lets a Git working tree be chosen; 'folder' accepts any folder
   * (the agent workspace can work anywhere).
   */
  mode?: 'repo' | 'folder';
  /** Called with the chosen folder and the machine it lives on. */
  onPicked: (folder: string, environmentId: string) => void | Promise<void>;
}

const EMPTY_RECENTS: Repository[] = [];

/** "Error invoking remote method 'fs:listDir': Error: ssh: …" -> "ssh: …" */
function readableError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}

/**
 * Pick a project folder without leaving the app.
 *
 * First choose the machine (this Mac or a connected SSH environment), then walk
 * its folders. Nothing here calls the native Finder panel.
 */
export default function AddProjectDialog({ onClose, mode = 'repo', onPicked }: Props) {
  const recentQuery = useRecentReposQuery();
  const recents = recentQuery.data ?? EMPTY_RECENTS;

  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [envId, setEnvId] = useState<string | null>(null);
  const [listing, setListing] = useState<FsBrowseListing | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .envList()
      .then((state) => {
        if (!alive) return;
        const connected = state.connectedIds ?? [];
        setEnvironments(state.environments);
        setConnectedIds(connected);
        // Prefer the default machine, but only if it is reachable right now.
        const preferred = connected.includes(state.activeId) ? state.activeId : connected[0];
        setEnvId(preferred || state.activeId || 'local');
      })
      .catch((e) => {
        if (!alive) return;
        setError(readableError(e));
        setEnvironments([]);
        setEnvId('local');
      });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async (environmentId: string, dir: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.listDir(environmentId, dir);
      setListing(next);
      setPathInput(next.path);
      setSelectedPath(null);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!envId) return;
    // Switching machines must not leave the previous machine's folders on screen.
    setListing(null);
    setSelectedPath(null);
    setPathInput('');
    void load(envId, null);
  }, [envId, load]);

  const env = useMemo(() => environments.find((e) => e.id === envId) ?? null, [environments, envId]);
  const envName = env ? (env.kind === 'local' ? 'this Mac' : env.name) : 'this machine';

  const selected = useMemo(
    () => listing?.entries.find((e) => e.path === selectedPath) ?? null,
    [listing, selectedPath],
  );

  // What "Add project" would pick right now: the selected folder, or this folder.
  const chosenPath =
    mode === 'folder'
      ? selected?.path ?? listing?.path ?? null
      : selected
        ? selected.isRepo
          ? selected.path
          : null
        : listing?.isRepo
          ? listing.path
          : null;

  const crumbs = useMemo(() => {
    if (!listing) return [];
    const out = [{ label: '/', path: '/' }];
    let acc = '';
    for (const part of listing.path.split('/').filter(Boolean)) {
      acc += `/${part}`;
      out.push({ label: part, path: acc });
    }
    return out;
  }, [listing]);

  const recentHere = useMemo(
    () => recents.filter((r) => (r.environment_id ?? 'local') === (envId ?? 'local')).slice(0, 6),
    [recents, envId],
  );

  const go = (dir: string | null) => {
    if (!envId || !dir) return;
    void load(envId, dir);
  };

  const choose = async (target: string) => {
    if (!envId) return;
    setBusy(true);
    setError(null);
    try {
      await onPicked(target, envId);
      onClose();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  const moveSelection = (delta: number) => {
    if (!listing || listing.entries.length === 0) return;
    const index = listing.entries.findIndex((e) => e.path === selectedPath);
    const nextIndex = index < 0 ? 0 : Math.min(listing.entries.length - 1, Math.max(0, index + delta));
    const next = listing.entries[nextIndex];
    setSelectedPath(next.path);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Enter') {
      if (chosenPath && !busy) {
        event.preventDefault();
        void choose(chosenPath);
      } else if (selected) {
        event.preventDefault();
        go(selected.path);
      }
    } else if (event.key === 'Backspace' || (event.key === 'ArrowLeft' && event.altKey)) {
      event.preventDefault();
      go(listing?.parent ?? null);
    }
  };

  const envOptions = environments.map((candidate) => ({
    value: candidate.id,
    label: candidate.kind === 'local' ? 'This Mac' : candidate.name,
    icon: candidate.kind === 'local' ? Laptop : Server,
  }));

  const footerHint = busy
    ? 'Adding project…'
    : selected
      ? mode === 'folder' || selected.isRepo
        ? `Use ${selected.name} on ${envName}`
        : `${selected.name} is not a Git repository`
      : listing?.isRepo
        ? `This folder on ${envName} is a Git repository`
        : mode === 'folder'
          ? `Use this folder on ${envName}`
          : 'Pick a folder that contains a .git directory';

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        title="Add project"
        description={`Choose the machine, then the folder ${mode === 'folder' ? 'the agent should work in.' : 'that holds your Git repository.'}`}
        size="lg"
        subheader={
          <div className="flex flex-col gap-2 pb-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-text-secondary shrink-0">Machine</span>
              {envId ? (
                <div className="flex-1 min-w-0 overflow-x-auto">
                  <Segmented aria-label="Machine" options={envOptions} value={envId} onChange={setEnvId} />
                </div>
              ) : (
                <Spinner size={14} />
              )}
            </div>
            {environments.length <= 1 && (
              <p className="text-xs text-text-muted">
                Only this Mac so far. Add an SSH environment in Settings to reach another machine.
              </p>
            )}
          </div>
        }
        footer={
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 text-sm text-text-muted truncate">{footerHint}</div>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={FolderGit2}
              loading={busy}
              disabled={!chosenPath}
              onClick={() => chosenPath && void choose(chosenPath)}
            >
              {mode === 'folder' ? 'Use this folder' : 'Add project'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
          <div className="flex items-center gap-1.5">
            <IconButton
              icon={ArrowUp}
              label="Go up one folder"
              size="sm"
              onClick={() => go(listing?.parent ?? null)}
              disabled={!listing?.parent || loading}
            />
            <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-hidden text-sm">
              {crumbs.map((crumb, i) => (
                <React.Fragment key={crumb.path}>
                  {i > 0 && <ChevronRight size={12} className="text-text-faint shrink-0" aria-hidden />}
                  <button
                    type="button"
                    onClick={() => go(crumb.path)}
                    className={cn(
                      'px-1 py-0.5 rounded hover:bg-bg-hover hover:text-text-primary truncate',
                      i === crumbs.length - 1 ? 'text-text-primary font-medium' : 'text-text-muted',
                    )}
                    title={crumb.path}
                  >
                    {crumb.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
            <IconButton
              icon={RefreshCw}
              label="Reload folder"
              size="sm"
              onClick={() => listing && go(listing.path)}
              disabled={loading}
            />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go(pathInput.trim() || null);
            }}
          >
            <Input
              mono
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder={env?.kind === 'ssh' ? `Path on ${env.name}` : '/path/to/repository'}
              spellCheck={false}
              aria-label="Folder path"
              className="text-sm"
            />
            <Button type="submit" disabled={loading}>
              Go
            </Button>
          </form>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-xs text-danger font-mono whitespace-pre-wrap break-words"
            >
              {error}
              {!listing && (
                <div className="mt-1.5 font-sans text-text-secondary">
                  Fix the connection for this machine in Settings → Environments, or choose another machine
                  above.
                </div>
              )}
            </div>
          )}

          {!listing && error ? null : (
          <div className="flex gap-2">
            <div
              ref={listRef}
              className="flex-1 min-w-0 overflow-auto max-h-[min(44vh,400px)] rounded-lg border border-border bg-bg-raised p-1"
            >
              {loading && !listing && (
                <div className="px-2.5 py-6 text-sm text-text-muted flex items-center gap-2">
                  <Spinner size={14} /> Reading folders…
                </div>
              )}
              {listing && listing.entries.length === 0 && !loading && (
                <div className="px-2.5 py-6 text-sm text-text-muted">No folders here.</div>
              )}
              <ul className="flex flex-col gap-px">
                {listing?.entries.map((entry) => {
                  const isSelected = entry.path === selectedPath;
                  return (
                    <li key={entry.path}>
                      <div
                        data-path={entry.path}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPath(entry.path)}
                        onDoubleClick={() => (entry.isRepo ? void choose(entry.path) : go(entry.path))}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.stopPropagation();
                          if (entry.isRepo || mode === 'folder') void choose(entry.path);
                          else go(entry.path);
                        }}
                        className={cn(
                          'group h-8 px-2 rounded-md flex items-center gap-2 text-sm cursor-default transition-colors duration-fast',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                          isSelected
                            ? 'bg-bg-hover text-text-primary shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong))]'
                            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                        )}
                      >
                        <Folder size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
                        <span className="truncate flex-1">{entry.name}</span>
                        {entry.isRepo && (
                          <Tag className="shrink-0 gap-1">
                            <GitBranch size={10} aria-hidden />
                            git
                          </Tag>
                        )}
                        <IconButton
                          icon={ChevronRight}
                          label={`Open ${entry.name}`}
                          size="sm"
                          tooltip={false}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            go(entry.path);
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="w-[168px] shrink-0 flex flex-col gap-0.5">
              <div className="px-2 pb-1 text-sm font-medium text-text-muted">Places</div>
              <button
                type="button"
                onClick={() => go(listing?.home ?? null)}
                title={listing?.home}
                className="h-8 px-2 rounded-md flex items-center gap-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary text-left"
              >
                <Laptop size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
                <span className="truncate">Home</span>
              </button>
              <button
                type="button"
                onClick={() => go('/')}
                title="Filesystem root"
                className="h-8 px-2 rounded-md flex items-center gap-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary text-left"
              >
                <Server size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
                <span className="truncate">Root</span>
              </button>

              {recentHere.length > 0 && (
                <>
                  <div className="px-2 pt-3 pb-1 text-sm font-medium text-text-muted">Recent here</div>
                  {recentHere.map((repo) => (
                    <button
                      key={repo.id}
                      type="button"
                      onClick={() => go(repo.path)}
                      title={repo.path}
                      className="h-8 px-2 rounded-md flex items-center gap-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary text-left"
                    >
                      <GitBranch size={13} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
                      <span className="truncate">{repo.name}</span>
                    </button>
                  ))}
                </>
              )}

              {env?.kind === 'ssh' && (
                <div className="mt-auto pt-2">
                  <Badge tone={connectedIds.includes(env.id) ? 'success' : 'neutral'} dot>
                    {connectedIds.includes(env.id) ? 'Connected' : 'Not connected'}
                  </Badge>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
