import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';

/** Vertical list of rows inside a card (the session info card, settings lists). */
export function MenuList({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-1.5 flex flex-col', className)} {...rest} />;
}

export function MenuSeparator() {
  return <div role="separator" className="h-px bg-border mx-1 my-1.5" />;
}

export interface MenuRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'value'> {
  icon?: LucideIcon;
  /** Custom leading element (e.g. a ProgressRing) instead of an icon. */
  leading?: ReactNode;
  label: ReactNode;
  /** Secondary text inline after the label, e.g. "vs main". */
  hint?: ReactNode;
  /** Right-aligned monospace value, e.g. "84k / 200k". */
  value?: ReactNode;
  /** "submenu" shows ›, "menu" shows ⌄. */
  trailing?: 'submenu' | 'menu' | ReactNode;
  tone?: 'default' | 'danger' | 'muted';
  selected?: boolean;
  /** Mono label, for branches and paths. */
  mono?: boolean;
}

export const MenuRow = forwardRef<HTMLButtonElement, MenuRowProps>(function MenuRow(
  { icon: Icon, leading, label, hint, value, trailing, tone = 'default', selected, mono, className, type = 'button', ...rest },
  ref,
) {
  const trail =
    trailing === 'submenu' ? <ChevronRight size={14} aria-hidden /> : trailing === 'menu' ? <ChevronDown size={14} aria-hidden /> : trailing;
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'group grid grid-cols-[20px_minmax(0,1fr)_auto_16px] items-center gap-2.5 h-[34px] px-2 rounded-lg text-left text-base',
        'transition-colors duration-fast focus-visible:outline-none focus-visible:bg-bg-hover',
        tone === 'danger' ? 'text-text-secondary hover:bg-danger/10 hover:text-danger' : 'hover:bg-bg-hover',
        tone === 'muted' && 'text-text-secondary',
        tone === 'default' && 'text-text-primary',
        selected && 'bg-bg-hover',
        className,
      )}
      {...rest}
    >
      <span className={cn('grid place-items-center text-text-secondary', tone === 'danger' && 'group-hover:text-danger')}>
        {leading ?? (Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />)}
      </span>
      <span className={cn('truncate font-medium', mono && 'font-mono text-sm')}>
        {label}
        {hint && <span className="ml-1.5 font-mono text-xs font-normal text-text-muted">{hint}</span>}
      </span>
      <span className="font-mono text-xs text-text-muted whitespace-nowrap">{value}</span>
      <span className="grid place-items-center text-text-muted">{trail}</span>
    </button>
  );
});
