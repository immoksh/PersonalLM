import { useState } from 'react';
import type { FileSourceKind } from '@personallm/shared';
import { Modal } from '@/components/Modal';
import { Dropzone } from '@/components/Dropzone';
import { Alert, Button } from '@/components/ui';
import { toFormErrors } from '@/lib/formErrors';
import { useUploadSources } from '../useSources';
import { SOURCE_TYPES } from '../sourceTypes';

interface FileUploadModalProps {
  /** Notebook the new source is filed under. */
  notebookId: string;
  kind: FileSourceKind;
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
}

/** File upload for the two file-backed kinds: a single PDF, or a batch of
 *  VTT/transcript files. The per-kind limit is enforced by the Dropzone. */
export function FileUploadModal({
  notebookId,
  kind,
  open,
  onClose,
  onDone,
}: FileUploadModalProps) {
  const meta = SOURCE_TYPES[kind];
  const upload = useUploadSources();

  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (upload.isPending) return; // Do not abandon an in-flight upload.
    setFiles([]);
    setError(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    try {
      const created = await upload.mutateAsync({ notebookId, kind, files });
      setFiles([]);
      onDone(created.length);
    } catch (caught) {
      setError(toFormErrors(caught).message ?? 'Upload failed');
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Upload ${meta.label}`}
      description={
        kind === 'pdf'
          ? 'Add a PDF document. Drag it in or browse — one at a time.'
          : 'Add caption or transcript files. Drag them in or browse.'
      }
      icon={meta.icon}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={upload.isPending} disabled={files.length === 0}>
            {files.length > 0 ? `Submit ${files.length} file${files.length === 1 ? '' : 's'}` : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Dropzone kind={kind} files={files} onChange={setFiles} disabled={upload.isPending} />
      </div>
    </Modal>
  );
}
