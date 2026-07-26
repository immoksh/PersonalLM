import { lazy, Suspense, useState } from 'react';
import { createTextSourceSchema, MAX_TEXT_LENGTH } from '@personallm/shared';
import type { FieldErrors } from '@personallm/shared';
import { Modal } from '@/components/Modal';
import { Alert, Button, Field, TextInput } from '@/components/ui';

// The editor pulls in TipTap/ProseMirror — roughly half the bundle. Loading it
// only when this modal opens keeps it off the initial page load.
const RichTextEditor = lazy(() =>
  import('@/components/RichTextEditor').then((module) => ({ default: module.RichTextEditor })),
);

const EditorFallback = () => (
  <div className="h-64 animate-pulse rounded-xl border border-border bg-surface-2" />
);
import { firstError, toFormErrors } from '@/lib/formErrors';
import { useCreateTextSource } from '../useSources';
import { SOURCE_TYPES } from '../sourceTypes';

interface PlainTextModalProps {
  /** Notebook the new source is filed under. */
  notebookId: string;
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
}

const EMPTY = { html: '', text: '', isEmpty: true };

/** Rich-text composer for `text` sources. */
export function PlainTextModal({ notebookId, open, onClose, onDone }: PlainTextModalProps) {
  const meta = SOURCE_TYPES.text;
  const createSource = useCreateTextSource();

  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState(EMPTY);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  // Remounts the editor after a successful submit to clear its internal state.
  const [editorKey, setEditorKey] = useState(0);

  const close = () => {
    if (createSource.isPending) return;
    setTitle('');
    setDoc(EMPTY);
    setFields({});
    setError(null);
    setEditorKey((key) => key + 1);
    onClose();
  };

  const submit = async () => {
    setFields({});
    setError(null);

    const parsed = createTextSourceSchema.safeParse({
      notebookId,
      title,
      // An "empty" TipTap doc is still `<p></p>`, so use its own emptiness check.
      content: doc.isEmpty ? '' : doc.html,
      plainText: doc.text,
    });

    if (!parsed.success) {
      setFields(toFormErrors(parsed.error).fields);
      return;
    }

    try {
      await createSource.mutateAsync(parsed.data);
      setTitle('');
      setDoc(EMPTY);
      setEditorKey((key) => key + 1);
      onDone(1);
    } catch (caught) {
      const formatted = toFormErrors(caught);
      setFields(formatted.fields);
      setError(formatted.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Add plain text"
      description="Write or paste your content. Formatting is preserved."
      icon={meta.icon}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={createSource.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={createSource.isPending}>
            Submit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <Field label="Title" htmlFor="text-source-title" error={firstError(fields, 'title')}>
          <TextInput
            id="text-source-title"
            placeholder="e.g. Meeting notes — Q3 planning"
            value={title}
            aria-invalid={Boolean(firstError(fields, 'title'))}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-text">Content</span>
          <Suspense fallback={<EditorFallback />}>
            <RichTextEditor
              key={editorKey}
              placeholder="Start writing, or paste text here…"
              onChange={setDoc}
            />
          </Suspense>
          <div className="flex items-center justify-between gap-3">
            {firstError(fields, 'content') ? (
              <p role="alert" className="text-sm text-danger">
                {firstError(fields, 'content')}
              </p>
            ) : (
              <span className="text-xs text-faint">Bold, headings, lists, quotes and links.</span>
            )}
            <span className="shrink-0 text-xs text-faint tabular-nums">
              {doc.text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
