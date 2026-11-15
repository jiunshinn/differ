import { Clock } from 'lucide-react';
import { cn } from '../utils/cn';

export type AgentStatus = 'running' | 'waiting' | 'failed' | 'done' | 'idle' | 'scheduled';

const labels: Record<AgentStatus, string> = {
  running: 'Running',
  waiting: 'Needs your approval',
  failed: 'Failed',
  done: 'Done',
  idle: 'Idle',
  scheduled: 'Scheduled',
};

/**
 * Thread status at a glance. Each state differs by shape as well as colour,
 * so it still reads without colour vision or with reduced motion:
 * running = solid + pulse, waiting = ring, failed = solid red, done = dim, scheduled = clock.
 */
export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const label = labels[status];
  if (status === 'scheduled') {
    return <Clock size={13} strokeWidth={1.75} className={cn('text-text-muted', className)} role="img" aria-label={label} />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        status === 'running' && 'bg-accent animate-status-pulse motion-reduce:animate-none',
        status === 'waiting' && 'border-[1.5px] border-warn',
        status === 'failed' && 'bg-danger',
        status === 'done' && 'bg-text-muted opacity-60',
        status === 'idle' && 'border-[1.5px] border-text-muted',
        className,
      )}
    />
  );
}
