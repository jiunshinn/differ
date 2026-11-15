import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';

const field =
  'w-full rounded-lg border border-border-strong bg-bg-raised text-base text-text-primary placeholder:text-text-muted ' +
  'transition-colors duration-fast outline-none hover:border-text-faint ' +
  'focus:border-accent/60 focus:ring-2 focus:ring-accent/15 ' +
  'aria-[invalid=true]:border-danger/60 aria-[invalid=true]:ring-danger/15 disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ icon: Icon, mono, className, ...rest }, ref) {
  if (!Icon) return <input ref={ref} className={cn(field, 'h-8 px-3', mono && 'font-mono text-sm', className)} {...rest} />;
  return (
    <span className={cn('relative block', className)}>
      <Icon size={15} strokeWidth={1.75} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      <input ref={ref} className={cn(field, 'h-8 pl-8 pr-3', mono && 'font-mono text-sm')} {...rest} />
    </span>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(field, 'px-3 py-2 leading-normal resize-none', className)} {...rest} />;
});

/** Label + control + help/error text. */
export function Field({
  label,
  help,
  error,
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-text-secondary">
        {label}
      </label>
      {children}
      {(error || help) && <p className={cn('text-xs', error ? 'text-danger' : 'text-text-muted')}>{error ?? help}</p>}
    </div>
  );
}
