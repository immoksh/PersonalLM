import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUpIcon, PlusIcon, StopIcon } from '@/components/icons';
import { cx } from '@/components/ui';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Cuts a streaming answer short; the send button becomes stop while busy. */
  onStop?: () => void;
  /** Opens the Add Source panel — attachments live in the library, not the chat. */
  onAttach: () => void;
  /** True while a reply is in flight; blocks a second send. */
  busy?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}

const MAX_ROWS_PX = 200;

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  onAttach,
  busy = false,
  autoFocus = false,
  placeholder = 'Ask anything',
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !busy;
  const canStop = busy && Boolean(onStop);

  // Grow with the text, then scroll. Height must be reset first or the box can
  // only ever get taller, never shrink back after a delete.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter is a newline; IME composition must never be cut short.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
      className="w-full"
    >
      <div
        className={cx(
          'flex items-end gap-1.5 rounded-3xl border border-border bg-surface-2 p-2 transition',
          'focus-within:border-neon/50 focus-within:shadow-[0_0_0_3px_var(--neon-soft)]',
        )}
      >
        <button
          type="button"
          onClick={onAttach}
          aria-label="Add a source"
          title="Add a source"
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-text"
        >
          <PlusIcon className="size-5" />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="Message"
          className="flex-1 resize-none self-center bg-transparent py-2 text-sm leading-6 text-text outline-none placeholder:text-faint"
          style={{ maxHeight: MAX_ROWS_PX }}
        />

        <button
          type={canStop ? 'button' : 'submit'}
          onClick={canStop ? onStop : undefined}
          disabled={!canSend && !canStop}
          aria-label={canStop ? 'Stop the reply' : 'Send message'}
          className={cx(
            'grid size-9 shrink-0 place-items-center rounded-full transition',
            'bg-neon text-neon-ink hover:brightness-110 disabled:opacity-35 disabled:hover:brightness-100',
            canSend && 'glow',
          )}
        >
          {busy ? <StopIcon className="size-4" /> : <ArrowUpIcon className="size-5" />}
        </button>
      </div>

      <p className="mt-2 text-center text-xs text-faint">
        Enter to send · Shift + Enter for a new line
      </p>
    </form>
  );
}
