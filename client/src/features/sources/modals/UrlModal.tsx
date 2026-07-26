import { useState } from 'react';
import {
  createWebsiteSourceSchema,
  createYouTubeSourceSchema,
  parseYouTubeId,
  youTubeThumbnail,
} from '@personallm/shared';
import type { FieldErrors } from '@personallm/shared';
import { Modal } from '@/components/Modal';
import { Alert, Button, Field, TextInput } from '@/components/ui';
import { firstError, toFormErrors } from '@/lib/formErrors';
import { useCreateWebsiteSource, useCreateYouTubeSource } from '../useSources';
import { SOURCE_TYPES } from '../sourceTypes';

interface UrlModalProps {
  kind: 'website' | 'youtube';
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
}

const COPY = {
  website: {
    description: 'Paste the address of the page you want to add.',
    label: 'Page URL',
    placeholder: 'https://example.com/article',
    hint: 'The page title is derived from the URL.',
  },
  youtube: {
    description: 'Paste a YouTube link. Watch, share, Shorts and embed URLs all work.',
    label: 'Video URL',
    placeholder: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    hint: 'Supports youtube.com/watch, youtu.be and /shorts links.',
  },
} as const;

/** Collects a single URL for the two link-backed kinds. */
export function UrlModal({ kind, open, onClose, onDone }: UrlModalProps) {
  const meta = SOURCE_TYPES[kind];
  const copy = COPY[kind];

  const createWebsite = useCreateWebsiteSource();
  const createYouTube = useCreateYouTubeSource();
  const mutation = kind === 'website' ? createWebsite : createYouTube;

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  // Live preview of the recognised video, which doubles as validation feedback.
  const videoId = kind === 'youtube' ? parseYouTubeId(url) : null;

  const close = () => {
    if (mutation.isPending) return;
    setUrl('');
    setTitle('');
    setFields({});
    setError(null);
    onClose();
  };

  const submit = async () => {
    setFields({});
    setError(null);

    const schema = kind === 'website' ? createWebsiteSourceSchema : createYouTubeSourceSchema;
    const parsed = schema.safeParse({ url, ...(title.trim() ? { title: title.trim() } : {}) });

    if (!parsed.success) {
      setFields(toFormErrors(parsed.error).fields);
      return;
    }

    try {
      if (kind === 'website') {
        await createWebsite.mutateAsync(parsed.data);
      } else {
        await createYouTube.mutateAsync(parsed.data);
      }
      setUrl('');
      setTitle('');
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
      title={`Add ${meta.label}`}
      description={copy.description}
      icon={meta.icon}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending} disabled={url.trim() === ''}>
            Submit
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error && <Alert>{error}</Alert>}

        <Field
          label={copy.label}
          htmlFor="source-url"
          error={firstError(fields, 'url')}
          hint={copy.hint}
        >
          <TextInput
            id="source-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder={copy.placeholder}
            value={url}
            aria-invalid={Boolean(firstError(fields, 'url'))}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>

        {videoId && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
            <img
              src={youTubeThumbnail(videoId)}
              alt=""
              loading="lazy"
              className="h-14 w-24 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">Video recognised</p>
              <p className="truncate font-mono text-xs text-faint">{videoId}</p>
            </div>
          </div>
        )}

        <Field
          label="Title"
          htmlFor="source-title"
          error={firstError(fields, 'title')}
          hint="Optional — a title is generated if you leave this blank."
        >
          <TextInput
            id="source-title"
            placeholder="Give it a name"
            value={title}
            aria-invalid={Boolean(firstError(fields, 'title'))}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        {/* Lets Enter submit the form without a visible duplicate button. */}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Submit
        </button>
      </form>
    </Modal>
  );
}
