import type { HTMLAttributes } from 'react';
import { cn } from '../utils/cn';

/** A keyboard shortcut hint, e.g. <Kbd>⌘K</Kbd>. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-[4px] border border-border-strong',
        'font-mono text-2xs font-medium text-text-muted',
        className,
      )}
      {...rest}
    />
  );
}
