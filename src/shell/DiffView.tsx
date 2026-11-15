import { useMemo } from 'react';
import { cn } from '../utils/cn';
import { hunks, lineDiff, type DiffLine } from './format';

export function useDiff(oldText: string | null | undefined, newText: string): DiffLine[] {
  return useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
}

/** Unified diff with collapsed unchanged regions. */
export function DiffView({ lines, className }: { lines: DiffLine[]; className?: string }) {
  const rows = useMemo(() => hunks(lines), [lines]);
  return (
    <div className={cn('font-mono text-xs leading-[1.65] overflow-x-auto', className)}>
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          <div key={i} className="px-3 py-0.5 bg-bg-hover/60 text-text-muted select-none">
            ⋯ {r.count} unchanged {r.count === 1 ? 'line' : 'lines'}
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              'grid grid-cols-[36px_36px_minmax(0,1fr)] whitespace-pre',
              r.kind === 'add' && 'bg-[var(--diff-add-bg)]',
              r.kind === 'del' && 'bg-[var(--diff-del-bg)]',
            )}
          >
            <span className="text-right pr-2 text-text-faint select-none">{r.oldNo ?? ''}</span>
            <span className="text-right pr-2 text-text-faint select-none">{r.newNo ?? ''}</span>
            <span className="pr-3">
              <span className={cn('select-none', r.kind === 'add' ? 'text-success' : r.kind === 'del' ? 'text-danger' : 'text-transparent')}>
                {r.kind === 'add' ? '+ ' : r.kind === 'del' ? '- ' : '  '}
              </span>
              {r.text}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
