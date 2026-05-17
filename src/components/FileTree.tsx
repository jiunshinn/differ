import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { api } from '../api';
import { cn } from '../utils/cn';
import type { TreeEntry } from '@shared/types';

interface Props {
  repoId: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

interface NodeProps extends Props {
  entry: TreeEntry;
  depth: number;
}

function DirChevron({ open }: { open: boolean }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return <Icon size={12} className="text-text-muted shrink-0" strokeWidth={2.25} />;
}

function EntryGlyph({ kind, open }: { kind: 'dir' | 'file'; open: boolean }) {
  if (kind === 'dir') {
    const Icon = open ? FolderOpen : Folder;
    return <Icon size={14} className="text-text-muted shrink-0" strokeWidth={1.75} />;
  }
  return <File size={14} className="text-text-muted shrink-0" strokeWidth={1.75} />;
}

function TreeNode({ entry, depth, repoId, selectedPath, onSelectFile }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (children || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const list = await api.listTree(repoId, entry.path);
      setChildren(list);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [children, loading, repoId, entry.path]);

  const toggle = () => {
    if (entry.kind !== 'dir') return;
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const onClick = () => {
    if (entry.kind === 'dir') toggle();
    else onSelectFile(entry.path);
  };

  const isSelected = entry.kind === 'file' && selectedPath === entry.path;

  return (
    <>
      <button
        onClick={onClick}
        title={entry.path}
        className={cn(
          'w-full h-7 px-2 flex items-center gap-1 text-sm text-left rounded-md',
          isSelected
            ? 'bg-accent/15 text-text-primary'
            : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {entry.kind === 'dir' ? (
          <DirChevron open={open} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <EntryGlyph kind={entry.kind} open={open} />
        <span className="truncate ml-1">{entry.name}</span>
      </button>
      {entry.kind === 'dir' && open && (
        <>
          {loading && (
            <div
              className="text-xs text-text-muted px-2 py-1"
              style={{ paddingLeft: 8 + (depth + 1) * 12 }}
            >
              Loading…
            </div>
          )}
          {err && (
            <div
              className="text-xs text-danger px-2 py-1"
              style={{ paddingLeft: 8 + (depth + 1) * 12 }}
            >
              {err}
            </div>
          )}
          {children?.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              repoId={repoId}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </>
      )}
    </>
  );
}

export default function FileTree({ repoId, selectedPath, onSelectFile }: Props) {
  const [roots, setRoots] = useState<TreeEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoots(null);
    setErr(null);
    api
      .listTree(repoId, '')
      .then((list) => {
        if (!cancelled) setRoots(list);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  if (err) {
    return <div className="text-sm text-danger p-3">{err}</div>;
  }
  if (!roots) {
    return <div className="text-sm text-text-muted p-3">Loading…</div>;
  }
  if (roots.length === 0) {
    return <div className="text-sm text-text-muted p-3">Empty repository</div>;
  }

  return (
    <div className="py-1.5">
      {roots.map((e) => (
        <TreeNode
          key={e.path}
          entry={e}
          depth={0}
          repoId={repoId}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
