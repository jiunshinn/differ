import type { ReactNode } from 'react';
import * as RP from '@radix-ui/react-popover';
import { cn } from '../utils/cn';

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverAnchor = RP.Anchor;
export const PopoverClose = RP.Close;

export interface PopoverContentProps {
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Small heading at the top, e.g. "MCP servers". */
  title?: ReactNode;
  /** Footer note and action, separated by a rule. */
  footer?: ReactNode;
  width?: number;
  arrow?: boolean;
  className?: string;
}

/** Rich detail panel (context breakdown, MCP list, subagents). */
export function PopoverContent({ children, side = 'bottom', align = 'end', title, footer, width = 340, arrow, className }: PopoverContentProps) {
  return (
    <RP.Portal>
      <RP.Content
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={12}
        style={{ width }}
        className={cn(
          'z-50 rounded-[14px] border border-border-strong bg-bg-raised shadow-popover outline-none animate-pop-in',
          'origin-[var(--radix-popover-content-transform-origin)]',
          className,
        )}
      >
        <div className="p-3.5 flex flex-col gap-3">
          {title && <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">{title}</div>}
          {children}
          {footer && <div className="flex items-center gap-2 pt-2.5 border-t border-border text-xs text-text-muted">{footer}</div>}
        </div>
        {arrow && <RP.Arrow width={12} height={6} className="fill-[rgb(var(--color-bg-raised))]" />}
      </RP.Content>
    </RP.Portal>
  );
}
