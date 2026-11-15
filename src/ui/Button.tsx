import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';
import { Kbd } from './Kbd';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /** Keyboard shortcut hint shown at the end, e.g. "⌘N" or "↵". */
  kbd?: string;
  loading?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium select-none ' +
  'transition-colors duration-fast ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg ' +
  'disabled:pointer-events-none disabled:opacity-45';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent border-accent text-on-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-bg-raised border-border-strong text-text-primary hover:bg-bg-hover',
  ghost: 'bg-transparent border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  danger: 'bg-transparent border-danger/35 text-danger hover:bg-danger/10',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-sm',
  md: 'h-8 px-3 text-base',
  lg: 'h-9 px-3.5 text-base',
};

const iconSize: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 16 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, kbd, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const px = iconSize[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Spinner size={px} /> : Icon ? <Icon size={px} strokeWidth={1.75} aria-hidden /> : null}
      {children}
      {IconRight && <IconRight size={px} strokeWidth={1.75} aria-hidden />}
      {kbd && <Kbd className={variant === 'primary' ? 'border-on-accent/30 text-on-accent/70' : undefined}>{kbd}</Kbd>}
    </button>
  );
});
