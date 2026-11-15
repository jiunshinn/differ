import { Check, ChevronDown, Cpu, type LucideIcon } from 'lucide-react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { visibleChoices, type ConfigSelector } from '@shared/protocol';

export interface ConfigPickerProps {
  selector: ConfigSelector;
  value: string | null;
  onChange: (value: string) => void;
  /** Leading icon; defaults to a CPU for model selectors. */
  icon?: LucideIcon;
  disabled?: boolean;
  /** Model values the user turned off in Settings → Models. */
  hidden?: string[];
}

/** Composer chip that switches a session config option (model, effort…). */
export function ConfigPicker({ selector, value, onChange, icon: Icon = Cpu, disabled, hidden }: ConfigPickerProps) {
  const choices = visibleChoices(selector, hidden);
  // The label comes from every choice: a model already selected in this thread
  // should still show its name even if it was hidden afterwards.
  const current = selector.choices.find((c) => c.value === value);
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${selector.label}: ${current?.name ?? 'Default'}`}
          title={current?.description ?? current?.name ?? selector.label}
          className="h-7 inline-flex items-center gap-1.5 px-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary data-[state=open]:bg-bg-hover data-[disabled]:opacity-50 max-w-[220px]"
        >
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{current?.name ?? 'Default'}</span>
          <ChevronDown size={13} className="text-text-muted shrink-0" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 min-w-[260px] max-w-[340px] p-1.5 rounded-xl border border-border-strong bg-bg-raised shadow-popover animate-pop-in max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
        >
          {choices.map((c) => (
            <Dropdown.Item
              key={c.value}
              className="flex items-start gap-2.5 min-h-8 px-2.5 py-1.5 rounded-md text-sm text-text-primary outline-none cursor-default data-[highlighted]:bg-bg-hover"
              onSelect={() => onChange(c.value)}
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate">{c.name}</span>
                {c.description && <span className="block truncate text-2xs text-text-muted">{c.description}</span>}
              </span>
              {c.value === value && <Check size={14} className="mt-1 shrink-0" />}
            </Dropdown.Item>
          ))}
          {choices.length === 0 && <p className="px-2.5 py-2 text-sm text-text-muted">Every model is hidden in Settings → Models.</p>}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

