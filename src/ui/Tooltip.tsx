import type { ReactNode } from 'react';
import * as RT from '@radix-ui/react-tooltip';
import { Kbd } from './Kbd';

/** Wrap the app once so tooltips share open/close delays. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RT.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

/** Short label on hover/focus. For rich, interactive content use HoverCard/Popover. */
export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex items-center gap-2 rounded-md border border-border-strong bg-bg-raised px-2 py-1 text-xs font-medium text-text-primary shadow-popover animate-pop-in"
        >
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
