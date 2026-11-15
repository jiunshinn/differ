import { cn } from '../utils/cn';

export interface ProgressRingProps {
  /** 0–1 */
  value: number;
  size?: number;
  stroke?: number;
  /** Turns warn at ≥ 0.8 and danger at ≥ 0.95 unless a tone is forced. */
  tone?: 'auto' | 'accent';
  label?: string;
  className?: string;
}

/** Context-window usage and other fill levels. */
export function ProgressRing({ value, size = 16, stroke = 2.5, tone = 'auto', label, className }: ProgressRingProps) {
  const v = Math.min(1, Math.max(0, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === 'auto' && v >= 0.95 ? 'text-danger' : tone === 'auto' && v >= 0.8 ? 'text-warn' : 'text-accent';
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('-rotate-90 shrink-0', color, className)}
      role="img"
      aria-label={label ?? `${Math.round(v * 100)}%`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border-strong" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        className="transition-[stroke-dashoffset] duration-slow ease-out"
      />
    </svg>
  );
}
