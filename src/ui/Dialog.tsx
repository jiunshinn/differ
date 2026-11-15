import type { ReactNode } from 'react';
import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../utils/cn';

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

export interface DialogContentProps {
  children: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** "md" 560px, "lg" 720px, "xl" a near-full-window pane for multi-section settings. */
  size?: 'md' | 'lg' | 'xl';
  /** Render children as the whole content (caller owns header/body layout). Still needs a Title for a11y. */
  bare?: boolean;
  /** Pinned above the scrolling body (e.g. tabs). */
  subheader?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Centered modal with a fixed header and footer and a scrolling body. */
export function DialogContent({ children, title, description, size = 'md', bare, subheader, footer, className }: DialogContentProps) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <RD.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'flex flex-col overflow-hidden rounded-[14px] border border-border-strong bg-bg-panel shadow-popover',
          'data-[state=open]:animate-pop-in outline-none',
          size === 'xl'
            ? 'w-[min(1120px,calc(100vw-96px))] h-[min(840px,calc(100vh-96px))]'
            : cn('w-[calc(100vw-48px)] max-h-[min(760px,calc(100vh-80px))]', size === 'lg' ? 'max-w-[760px]' : 'max-w-[560px]'),
          className,
        )}
      >
        {bare ? (
          <>
            <RD.Title className="sr-only">{typeof title === 'string' ? title : 'Settings'}</RD.Title>
            <RD.Description className="sr-only">Settings</RD.Description>
            {children}
          </>
        ) : (
          <>
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 shrink-0">
          <div className="min-w-0 flex-1">
            <RD.Title className="text-xl font-semibold tracking-[-0.015em]">{title}</RD.Title>
            {description ? (
              <RD.Description className="mt-1 text-sm text-text-secondary">{description}</RD.Description>
            ) : (
              <RD.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>
            )}
          </div>
          <RD.Close asChild>
            <button
              type="button"
              aria-label="Close"
              className="shrink-0 w-7 h-7 -mr-1 rounded-[7px] grid place-items-center text-text-muted hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </RD.Close>
        </header>
        {subheader && <div className="px-5 shrink-0">{subheader}</div>}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="shrink-0 border-t border-border px-5 py-3 bg-bg-panel">{footer}</footer>}
          </>
        )}
      </RD.Content>
    </RD.Portal>
  );
}
