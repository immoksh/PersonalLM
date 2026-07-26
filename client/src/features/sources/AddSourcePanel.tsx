import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isFileSourceKind, type FileSourceKind, type SourceKind } from '@personallm/shared';
import { CheckIcon, CloseIcon } from '@/components/icons';
import { cx } from '@/components/ui';
import { SOURCE_TYPE_LIST } from './sourceTypes';
import { FileUploadModal } from './modals/FileUploadModal';
import { PlainTextModal } from './modals/PlainTextModal';
import { UrlModal } from './modals/UrlModal';

interface AddSourcePanelProps {
  open: boolean;
  onClose: () => void;
  /** Notebook every source added here is filed under. */
  notebookId: string;
}

/**
 * Right-hand slide-over launched by "Add Source". It presents the five source
 * types as tiles; picking one opens the matching collection dialog.
 */
export function AddSourcePanel({ open, onClose, notebookId }: AddSourcePanelProps) {
  const [activeKind, setActiveKind] = useState<SourceKind | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Read through refs so this effect depends on `open` alone. Including
  // `onClose` (a fresh arrow each render) or `activeKind` would re-run it —
  // and its cleanup pulls focus back to the panel, out of the open dialog.
  const onCloseRef = useRef(onClose);
  const activeKindRef = useRef(activeKind);
  useEffect(() => {
    onCloseRef.current = onClose;
    activeKindRef.current = activeKind;
  });

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      // Let an open dialog handle Escape first — it closes on top of the panel.
      if (event.key === 'Escape' && !activeKindRef.current) onCloseRef.current();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Clear the confirmation banner a few seconds after it appears.
  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  const handleDone = (count: number) => {
    setActiveKind(null);
    setConfirmation(
      count === 1 ? '1 source added to your library' : `${count} sources added to your library`,
    );
  };

  if (!open) return null;

  const fileKind: FileSourceKind | null =
    activeKind && isFileSourceKind(activeKind) ? activeKind : null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 flex justify-end">
        <div
          className="animate-fade-in absolute inset-0 bg-bg-deep/70 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden
        />

        <aside
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-source-heading"
          className="animate-slide-in-right relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-2xl outline-none"
        >
          <div className="h-px w-full bg-gradient-to-r from-transparent via-neon to-transparent" />

          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id="add-source-heading" className="text-lg font-semibold text-text">
                Add a source
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                Choose where this content is coming from.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="-mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text"
            >
              <CloseIcon className="size-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-5">
            {confirmation && (
              <p
                role="status"
                className="mb-4 flex items-center gap-2 rounded-lg border border-neon/30 bg-neon-soft px-3 py-2 text-sm text-neon"
              >
                <CheckIcon className="size-4 shrink-0" />
                {confirmation}
              </p>
            )}

            {SOURCE_TYPE_LIST.map((type) => (
              <button
                key={type.kind}
                type="button"
                onClick={() => setActiveKind(type.kind)}
                className={cx(
                  'group flex w-full items-center gap-4 rounded-xl border border-border bg-surface-2 p-4 text-left transition',
                  'hover:-translate-y-0.5 hover:border-transparent hover:shadow-lg',
                  type.accent === 'neon' ? 'hover:glow' : 'hover:glow-violet',
                )}
              >
                <span
                  className={cx(
                    'grid size-11 shrink-0 place-items-center rounded-xl transition group-hover:scale-105',
                    type.accent === 'neon'
                      ? 'bg-neon-soft text-neon group-hover:bg-neon group-hover:text-neon-ink'
                      : 'bg-violet-soft text-violet group-hover:bg-violet group-hover:text-white',
                  )}
                >
                  {type.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-text">{type.label}</span>
                  <span className="block text-sm text-muted">{type.blurb}</span>
                </span>
                <span
                  aria-hidden
                  className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-text"
                >
                  →
                </span>
              </button>
            ))}
          </div>

          <footer className="border-t border-border px-5 py-3">
            <p className="text-xs text-faint">
              PDFs and transcripts accept multiple files per upload.
            </p>
          </footer>
        </aside>
      </div>

      {fileKind && (
        <FileUploadModal
          notebookId={notebookId}
          kind={fileKind}
          open
          onClose={() => setActiveKind(null)}
          onDone={handleDone}
        />
      )}

      <PlainTextModal
        notebookId={notebookId}
        open={activeKind === 'text'}
        onClose={() => setActiveKind(null)}
        onDone={handleDone}
      />

      {(activeKind === 'website' || activeKind === 'youtube') && (
        <UrlModal
          notebookId={notebookId}
          kind={activeKind}
          open
          onClose={() => setActiveKind(null)}
          onDone={handleDone}
        />
      )}
    </>,
    document.body,
  );
}
