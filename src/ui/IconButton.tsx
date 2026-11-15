import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Accessible name; also shown as the tooltip. */
  label: string;
  /** Shortcut appended to the tooltip. */
  shortcut?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary';
  active?: boolean;
  /** Set false to suppress the tooltip (e.g. when wrapped by a menu trigger that has its own). */
  tooltip?: boolean;
}

const sizes = { sm: 'w-6 h-6 rounded-md', md: 'w-7 h-7 rounded-[7px]', lg: 'w-8 h-8 rounded-lg' } as const;
const iconPx = { sm: 14, md: 16, lg: 16 } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, size = 'md', variant = 'ghost', active, tooltip = true, className, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-grid place-items-center shrink-0 border transition-colors duration-fast ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-45',
        variant === 'ghost'
          ? 'border-transparent text-text-muted hover:bg-bg-hover hover:text-text-primary'
          : 'border-border-strong bg-bg-raised text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        active && 'bg-bg-raised text-text-primary shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong))]',
        sizes[size],
        className,
      )}
      {...rest}
    >
      <Icon size={iconPx[size]} strokeWidth={1.75} aria-hidden />
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
});
