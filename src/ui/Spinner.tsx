import { LoaderCircle } from 'lucide-react';
import { cn } from '../utils/cn';

export function Spinner({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <LoaderCircle
      size={size}
      strokeWidth={2}
      className={cn('animate-spin motion-reduce:animate-none', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
