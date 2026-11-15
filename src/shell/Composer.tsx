import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Kbd, Spinner } from '../ui';
import { cn } from '../utils/cn';

export interface ComposerProps {
  placeholder: string;
  /** Called with the trimmed text. Clears the box when it resolves; keeps the text if it throws. */
  onSend: (text: string) => Promise<void>;
  /** Shows a Stop button instead of Send. */
  running?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Controls shown on the left of the bottom row (agent, folder…). */
  footer?: ReactNode;
  error?: string | null;
}

export function Composer({ placeholder, onSend, running, onStop, disabled, autoFocus, footer, error }: ComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to ~10 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const canSend = !!text.trim() && !sending && !disabled && !running;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(text.trim());
      setText('');
    } catch {
      // The caller shows the error; keep the text so nothing is lost.
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'rounded-[14px] border border-border-strong bg-bg-panel shadow-float transition-colors duration-fast',
          'focus-within:border-accent/40',
          disabled && 'opacity-60',
        )}
      >
        <textarea
          ref={ref}
          value={text}
          rows={2}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="block w-full min-h-[56px] bg-transparent outline-none resize-none px-4 pt-3.5 pb-1 text-md leading-normal text-text-primary placeholder:text-text-muted"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2 pt-1">
          <div className="flex items-center gap-0.5 min-w-0">{footer}</div>
          <span className="ml-auto hidden sm:flex items-center gap-1 text-2xs text-text-faint mr-1">
            <Kbd>⇧↵</Kbd> new line
          </span>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop the agent"
              title="Stop (⌃C)"
              className="w-8 h-8 rounded-full bg-bg-hover text-text-primary grid place-items-center hover:bg-danger/15 hover:text-danger transition-colors duration-fast"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              aria-label="Send"
              className="w-8 h-8 rounded-full bg-accent text-on-accent grid place-items-center hover:bg-accent-hover disabled:opacity-35 transition-colors duration-fast"
            >
              {sending ? <Spinner size={14} /> : <ArrowUp size={16} strokeWidth={2.25} />}
            </button>
          )}
        </div>
      </div>
      {error && <p className="px-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
