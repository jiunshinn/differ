import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils/cn';

export type CardTone = 'default' | 'warn' | 'danger';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** "warn" is for things that need the user (permission requests). */
  tone?: CardTone;
}

export function Card({ tone = 'default', className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border',
        tone === 'default' && 'border-border bg-bg-panel',
        tone === 'warn' && 'border-warn/35 bg-[linear-gradient(rgb(var(--color-warn)/0.10),rgb(var(--color-warn)/0.10)),rgb(var(--color-bg-panel))]',
        tone === 'danger' && 'border-danger/35 bg-[linear-gradient(rgb(var(--color-danger)/0.08),rgb(var(--color-danger)/0.08)),rgb(var(--color-bg-panel))]',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ title, meta, actions, className }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 min-h-11 pl-4 pr-2.5 py-2', className)}>
      <span className="font-medium text-text-primary">{title}</span>
      {meta && <span className="text-sm text-text-muted truncate">{meta}</span>}
      {actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-t border-border', className)} {...rest} />;
}

/** Translucent floating surface for overlays pinned over content (session bar, info card). */
export function FloatingSurface({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[12px] border border-border-strong bg-[var(--surface-glass)] backdrop-blur-xl backdrop-saturate-150 shadow-float', className)}
      {...rest}
    />
  );
}
