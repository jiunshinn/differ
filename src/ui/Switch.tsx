import { cn } from '../utils/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; also the tooltip. */
  label: string;
  disabled?: boolean;
}

/** Small on/off switch, used for model visibility. */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative shrink-0 h-[18px] w-[30px] rounded-full transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        checked ? 'bg-accent' : 'bg-border-strong',
        disabled && 'opacity-45',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] left-[2px] size-[14px] rounded-full transition-transform duration-fast',
          checked ? 'translate-x-[12px] bg-on-accent' : 'translate-x-0 bg-text-muted',
        )}
      />
    </button>
  );
}
