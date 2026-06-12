import React, { useRef, useState } from 'react';

export type ResizablePane = {
  defaultSize: number;
  minSize?: number;
  maxSize?: number;
  flex?: boolean;
};

type Props = {
  storageKey: string;
  panes: ResizablePane[];
  children: React.ReactNode;
  className?: string;
};

const HANDLE_WIDTH = 4;

function clamp(value: number, pane: ResizablePane): number {
  const min = pane.minSize ?? 0;
  const max = pane.maxSize ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(value, min), max);
}

export default function ResizableLayout({ storageKey, panes, children, className }: Props) {
  const allItems = React.Children.toArray(children);
  // The first `panes.length` children are laid out as resizable panes; any
  // extra children (conditional overlays/portals such as a comment composer)
  // are rendered after the grid instead of crashing the renderer.
  const items = allItems.slice(0, panes.length);
  const extraItems = allItems.slice(panes.length);

  const fullKey = `differ:resizable:${storageKey}`;
  const [sizes, setSizes] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === panes.length) {
          return parsed.map((v, i) => clamp(Number(v) || panes[i].defaultSize, panes[i]));
        }
      }
    } catch {
      /* ignore */
    }
    return panes.map((p) => p.defaultSize);
  });

  // Keep the latest sizes in a ref so the drag-end persist sees the live value
  // without re-coupling the storage write to every per-move render.
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  const persistSizes = () => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(sizesRef.current));
    } catch {
      /* ignore */
    }
  };

  const startDrag = (handleIndex: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startSizes = [...sizes];
    const leftIdx = handleIndex;
    const rightIdx = handleIndex + 1;
    const leftCfg = panes[leftIdx];
    const rightCfg = panes[rightIdx];

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const next = [...startSizes];
      if (leftCfg.flex && !rightCfg.flex) {
        next[rightIdx] = clamp(startSizes[rightIdx] - dx, rightCfg);
      } else if (rightCfg.flex && !leftCfg.flex) {
        next[leftIdx] = clamp(startSizes[leftIdx] + dx, leftCfg);
      } else if (!leftCfg.flex && !rightCfg.flex) {
        const desiredLeft = clamp(startSizes[leftIdx] + dx, leftCfg);
        const actualDelta = desiredLeft - startSizes[leftIdx];
        const desiredRight = clamp(startSizes[rightIdx] - actualDelta, rightCfg);
        const correctedLeft = startSizes[leftIdx] + (startSizes[rightIdx] - desiredRight);
        next[leftIdx] = clamp(correctedLeft, leftCfg);
        next[rightIdx] = desiredRight;
      }
      setSizes(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      // Persist only once, when the drag finishes (or is cancelled), instead of
      // on every coalesced pointermove.
      persistSizes();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // touch/pen drags can be taken over by an OS gesture, which fires
    // pointercancel instead of pointerup — tear down on that too.
    window.addEventListener('pointercancel', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const cols: string[] = [];
  panes.forEach((p, i) => {
    cols.push(p.flex ? 'minmax(0,1fr)' : `${sizes[i]}px`);
    if (i < panes.length - 1) cols.push(`${HANDLE_WIDTH}px`);
  });

  return (
    <>
      <div
        className={className}
        style={{ display: 'grid', gridTemplateColumns: cols.join(' ') }}
      >
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {child}
            {i < items.length - 1 && (
              <div
                role="separator"
                aria-orientation="vertical"
                onPointerDown={startDrag(i)}
                style={{ touchAction: 'none' }}
                className="group relative h-full cursor-col-resize select-none"
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-transparent group-hover:bg-accent transition-colors" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      {extraItems}
    </>
  );
}
