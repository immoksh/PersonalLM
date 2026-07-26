import { useEffect, useState } from 'react';
import {
  createNotebookSchema,
  DEFAULT_NOTEBOOK_EMOJI,
  MAX_NOTEBOOK_DESCRIPTION_LENGTH,
  NOTEBOOK_EMOJI,
  type FieldErrors,
  type Notebook,
} from '@personallm/shared';
import { Modal } from '@/components/Modal';
import { LayersIcon } from '@/components/icons';
import { Alert, Button, Field, TextInput, cx } from '@/components/ui';
import { firstError, toFormErrors } from '@/lib/formErrors';
import { useCreateNotebook, useUpdateNotebook } from './useNotebooks';

interface NotebookFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Absent creates a notebook; present renames the one given. */
  notebook?: Notebook;
  onCreated?: (notebook: Notebook) => void;
}

/** Creates or renames a notebook — one dialog, because the fields are identical. */
export function NotebookFormModal({ open, onClose, notebook, onCreated }: NotebookFormModalProps) {
  const isEdit = Boolean(notebook);
  const create = useCreateNotebook();
  const update = useUpdateNotebook();
  const mutation = isEdit ? update : create;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState<string>(DEFAULT_NOTEBOOK_EMOJI);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  // Seed from the notebook being edited each time the dialog opens, so a
  // cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    setTitle(notebook?.title ?? '');
    setDescription(notebook?.description ?? '');
    setEmoji(notebook?.emoji ?? DEFAULT_NOTEBOOK_EMOJI);
    setFields({});
    setError(null);
  }, [open, notebook]);

  const close = () => {
    if (mutation.isPending) return;
    onClose();
  };

  const submit = async () => {
    setFields({});
    setError(null);

    const parsed = createNotebookSchema.safeParse({
      title,
      emoji,
      ...(description.trim() ? { description } : {}),
    });
    if (!parsed.success) {
      setFields(toFormErrors(parsed.error).fields);
      return;
    }

    try {
      if (notebook) {
        // Description is sent even when cleared, so emptying it actually sticks.
        await update.mutateAsync({ id: notebook.id, ...parsed.data, description });
      } else {
        onCreated?.(await create.mutateAsync(parsed.data));
      }
      onClose();
    } catch (thrown) {
      const formErrors = toFormErrors(thrown);
      setFields(formErrors.fields);
      setError(formErrors.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={isEdit ? 'Rename notebook' : 'New notebook'}
      description={
        isEdit
          ? 'Change how this notebook is labelled.'
          : 'A notebook keeps its own sources, and answers only ever come from them.'
      }
      icon={<LayersIcon className="size-4" />}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={mutation.isPending}>
            {isEdit ? 'Save' : 'Create notebook'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <Field label="Name" htmlFor="notebook-title" error={firstError(fields, 'title')}>
          <TextInput
            id="notebook-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Thesis research"
            aria-invalid={Boolean(firstError(fields, 'title'))}
            autoFocus
          />
        </Field>

        <Field
          label="Description"
          htmlFor="notebook-description"
          error={firstError(fields, 'description')}
          hint="Optional — what this notebook is for."
        >
          <TextInput
            id="notebook-description"
            value={description}
            maxLength={MAX_NOTEBOOK_DESCRIPTION_LENGTH}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Papers and interviews for chapter 3"
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-text">Icon</legend>
          <div className="flex flex-wrap gap-1.5">
            {NOTEBOOK_EMOJI.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setEmoji(option)}
                aria-pressed={emoji === option}
                aria-label={`Icon ${option}`}
                className={cx(
                  'grid size-9 place-items-center rounded-lg border text-lg transition',
                  emoji === option
                    ? 'border-neon bg-neon-soft'
                    : 'border-border hover:border-border-strong',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
