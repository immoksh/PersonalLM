import { useCallback, useRef, useState, type DragEvent } from 'react';
import {
  FILE_ACCEPT,
  MAX_FILE_BYTES,
  acceptAttribute,
  formatBytes,
  hasAllowedExtension,
  maxFilesForKind,
  type FileSourceKind,
} from '@personallm/shared';
import { FileIcon, TrashIcon, UploadIcon } from './icons';
import { Button, cx } from './ui';

interface DropzoneProps {
  kind: FileSourceKind;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/** Same file dropped twice (or picked twice) should not queue twice. */
const identity = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

export function Dropzone({ kind, files, onChange, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const maxFiles = maxFilesForKind(kind);
  const allowsMultiple = maxFiles > 1;
  // Nested dragenter/dragleave events fire constantly; counting them keeps the
  // highlight stable instead of flickering over child elements.
  const dragDepth = useRef(0);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;

      const problems: string[] = [];
      // Single-file kinds replace the current selection, so ignore what is
      // already queued when deciding what counts as a duplicate.
      const existing = new Set(allowsMultiple ? files.map(identity) : []);
      const accepted: File[] = [];

      for (const file of Array.from(incoming)) {
        if (!hasAllowedExtension(file.name, kind)) {
          problems.push(`${file.name} — unsupported type`);
        } else if (file.size > MAX_FILE_BYTES) {
          problems.push(`${file.name} — larger than ${formatBytes(MAX_FILE_BYTES)}`);
        } else if (existing.has(identity(file))) {
          problems.push(`${file.name} — already added`);
        } else {
          existing.add(identity(file));
          accepted.push(file);
        }
      }

      // A single-file kind takes only the newest pick and replaces any prior one.
      if (!allowsMultiple) {
        if (accepted.length > 1) problems.push('Upload one file at a time');
        setRejected(problems);
        if (accepted.length > 0) onChange([accepted[accepted.length - 1]]);
        return;
      }

      const room = maxFiles - files.length;
      if (accepted.length > room) {
        problems.push(`Only ${maxFiles} files can be uploaded at once`);
      }

      setRejected(problems);
      if (accepted.length > 0) onChange([...files, ...accepted.slice(0, Math.max(room, 0))]);
    },
    [allowsMultiple, files, kind, maxFiles, onChange],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (!disabled) addFiles(event.dataTransfer.files);
  };

  const removeAt = (index: number) => {
    onChange(files.filter((_, position) => position !== index));
    setRejected([]);
  };

  // Single-file kinds are never "full": a new drop replaces the current file.
  const isFull = allowsMultiple && files.length >= maxFiles;

  return (
    <div className="space-y-3">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setIsDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={cx(
          'relative rounded-xl border-2 border-dashed px-6 py-9 text-center transition',
          isDragging
            ? 'border-neon bg-neon-soft'
            : 'border-border bg-surface-2/40 hover:border-border-strong',
          (disabled || isFull) && 'pointer-events-none opacity-60',
        )}
      >
        <span
          className={cx(
            'mx-auto mb-3 grid size-11 place-items-center rounded-xl transition',
            isDragging ? 'bg-neon text-neon-ink' : 'bg-neon-soft text-neon',
          )}
        >
          <UploadIcon className="size-5" />
        </span>

        <p className="text-sm font-medium text-text">
          {isDragging
            ? 'Release to add'
            : allowsMultiple
              ? 'Drag & drop files here'
              : 'Drag & drop a file here'}
        </p>
        <p className="mt-1 text-xs text-faint">
          {FILE_ACCEPT[kind].extensions.join(', ')} · up to {formatBytes(MAX_FILE_BYTES)}{' '}
          {allowsMultiple ? `each · ${maxFiles} max` : 'max · one at a time'}
        </p>

        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isFull}
        >
          Browse files
        </Button>

        <input
          ref={inputRef}
          type="file"
          multiple={allowsMultiple}
          accept={acceptAttribute(kind)}
          className="sr-only"
          onChange={(event) => {
            addFiles(event.target.files);
            // Reset so picking the same file again still fires onChange.
            event.target.value = '';
          }}
        />
      </div>

      {rejected.length > 0 && (
        <ul role="alert" className="space-y-1 text-xs text-danger">
          {rejected.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file, index) => (
            <li
              key={identity(file)}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
            >
              <FileIcon className="size-4 shrink-0 text-neon" />
              <span className="min-w-0 flex-1 truncate text-sm text-text" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-xs text-faint">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => removeAt(index)}
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded p-1 text-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
              >
                <TrashIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
