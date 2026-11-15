import { useRef, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  className?: string;
}

/** Switches between views of the same thing (Conversation / Review / Terminal). Arrow keys move. */
export function Segmented<T extends string>({ options, value, onChange, className, ...aria }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={aria['aria-label']} className={cn('flex gap-0.5', className)}>
      {options.map((opt, i) => {
        const on = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              on
                ? 'bg-bg-raised text-text-primary shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong))]'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
          >
            {Icon && <Icon size={15} strokeWidth={1.75} aria-hidden />}
            {opt.label}
            {opt.count !== undefined && <span className="font-mono text-2xs text-text-muted">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
