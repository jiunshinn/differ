import type { HTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-bg-hover text-text-secondary',
  accent: 'bg-accent/12 text-accent',
  success: 'bg-success/12 text-success',
  warn: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Leading coloured dot. */
  dot?: boolean;
  /** Outlined instead of filled; used for "needs you" states. */
  outline?: boolean;
}

/** Rounded status pill: "Running", "Connected", "Failed". */
export function Badge({ tone = 'neutral', dot, outline, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-5 px-2 rounded-pill text-xs font-medium whitespace-nowrap',
        outline ? cn('bg-transparent shadow-[inset_0_0_0_1px_currentColor]', tones[tone].split(' ')[1]) : tones[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** Small monospace label: agent, host, branch, model. */
export function Tag({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-5 px-1.5 rounded-[5px] bg-bg-hover font-mono text-2xs font-medium text-text-secondary whitespace-nowrap',
        className,
      )}
      {...rest}
    />
  );
}
