import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { cn } from '../utils/cn';
import { useTreeQuery } from '../query/hooks';
import type { TreeEntry } from '@shared/types';

interface Props {
  repoId: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

// Shared per-render context for the whole tree. Expansion state is lifted here
// (instead of component-local useState) so collapsing a directory does not
// unmount — and therefore discard — the expansion state of its descendants.
interface TreeCtx {
  repoId: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expanded: Set<string>;
  toggle: (path: string) => void;
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

function rowClass(isSelected: boolean): string {
  return cn(
    'w-full h-7 px-2 flex items-center gap-1 text-sm text-left rounded-md',
    isSelected
      ? 'bg-accent/15 text-text-primary'
      : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
  );
}

// A leaf file row. Hook-free, so it never instantiates a React Query observer,
// and memoized on its own props so a selection change elsewhere in the tree
// does not re-render every file in the repository.
const FileRow = React.memo(function FileRow({
  entry,
  depth,
  isSelected,
  onSelectFile,
}: {
  entry: TreeEntry;
  depth: number;
  isSelected: boolean;
  onSelectFile: (path: string) => void;
}) {
  return (
    <button
      onClick={() => onSelectFile(entry.path)}
      title={entry.path}
      className={rowClass(isSelected)}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <span className="w-3 shrink-0" />
      <EntryGlyph kind="file" open={false} />
      <span className="truncate ml-1">{entry.name}</span>
    </button>
  );
});

// A directory row. Only directory nodes hold a tree query, and only while open,
// so closed/collapsed subtrees and file leaves create no observers.
function DirNode({ entry, depth, ctx }: { entry: TreeEntry; depth: number; ctx: TreeCtx }) {
  const open = ctx.expanded.has(entry.path);
  const childrenQuery = useTreeQuery(ctx.repoId, entry.path, open);
  const children = childrenQuery.data;
  const loading = childrenQuery.isFetching;
  const err = childrenQuery.error instanceof Error ? childrenQuery.error.message : null;

  return (
    <>
      <button
        onClick={() => ctx.toggle(entry.path)}
        title={entry.path}
        className={rowClass(false)}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <DirChevron open={open} />
        <EntryGlyph kind="dir" open={open} />
        <span className="truncate ml-1">{entry.name}</span>
      </button>
      {open && (
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
            <TreeNode key={c.path} entry={c} depth={depth + 1} ctx={ctx} />
          ))}
        </>
      )}
    </>
  );
}

function TreeNode({ entry, depth, ctx }: { entry: TreeEntry; depth: number; ctx: TreeCtx }) {
  if (entry.kind === 'dir') {
    return <DirNode entry={entry} depth={depth} ctx={ctx} />;
  }
  return (
    <FileRow
      entry={entry}
      depth={depth}
      isSelected={ctx.selectedPath === entry.path}
      onSelectFile={ctx.onSelectFile}
    />
  );
}

export default function FileTree({ repoId, selectedPath, onSelectFile }: Props) {
  const rootsQuery = useTreeQuery(repoId, '');
  const roots = rootsQuery.data;
  const err = rootsQuery.error instanceof Error ? rootsQuery.error.message : null;

  // Lifted expansion state survives unmounts: collapsing then re-expanding a
  // parent keeps every previously expanded descendant open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const ctx = useMemo<TreeCtx>(
    () => ({ repoId, selectedPath, onSelectFile, expanded, toggle }),
    [repoId, selectedPath, onSelectFile, expanded, toggle],
  );

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
        <TreeNode key={e.path} entry={e} depth={0} ctx={ctx} />
      ))}
    </div>
  );
}
