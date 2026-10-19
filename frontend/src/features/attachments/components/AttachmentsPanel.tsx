import { useRef, useState } from 'react';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';

import { Button, Card, CardBody, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { friendlyDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  useAttachments,
  useDeleteAttachment,
  useDownloadAttachment,
  useUploadAttachment,
  type Attachment,
} from '../api/useAttachments';

/**
 * Attachments on a record.
 *
 * iTop keeps attachments in a standalone `Attachment` class joined through
 * `item_class` + `item_id`, so they are NOT part of the presentation metadata
 * the rest of the detail screen renders. That is why this is its own panel
 * rather than a fieldset: there is no iTop layout entry to honour.
 */

/** Matches the BFF's limit, which is derived from iTop's post_max_size. */
const MAX_BYTES = 32 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentRow({
  attachment,
  className: itopClass,
  id,
  basePath,
  canDelete,
}: {
  attachment: Attachment;
  className: string;
  id: string;
  basePath?: string;
  canDelete: boolean;
}) {
  const download = useDownloadAttachment(itopClass, id, basePath);
  const remove = useDeleteAttachment(itopClass, id, basePath);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-attachment={attachment.id}>
      <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink" title={attachment.filename}>
          {attachment.filename}
        </span>
        <span className="block truncate text-[12px] text-ink-muted">
          {[
            formatSize(attachment.size),
            attachment.mimeType,
            attachment.uploadedAt ? friendlyDateTime(attachment.uploadedAt) : null,
            attachment.uploadedBy ? `by ${attachment.uploadedBy.name}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>

      {confirming ? (
        <span className="flex items-center gap-2">
          <span className="text-[12.5px] text-ink-secondary">Delete this file?</span>
          <Button
            size="sm"
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate(attachment.id, { onSuccess: () => setConfirming(false) })}
          >
            Delete
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Download className="size-3.5" />}
            loading={download.isPending}
            onClick={() => download.mutate(attachment)}
          >
            Download
          </Button>
          {canDelete ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Delete ${attachment.filename}`}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </span>
      )}

      {download.isError || remove.isError ? (
        <span role="alert" className="w-full text-[12.5px] text-critical-ink">
          {((download.error ?? remove.error) as Error).message}
        </span>
      ) : null}
    </li>
  );
}

export function AttachmentsPanel({
  className: itopClass,
  id,
  basePath,
  canDelete = true,
}: {
  className: string;
  id: string;
  /** Overrides the endpoint, for the self-service portal's scoped routes. */
  basePath?: string;
  /** End users may add files but, as in iTop's portal, not remove them. */
  canDelete?: boolean;
}) {
  const { data, isLoading, isError, error } = useAttachments(itopClass, id, true, basePath);
  const upload = useUploadAttachment(itopClass, id, basePath);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const choose = (file: File | undefined) => {
    setRejected(null);
    if (!file) return;

    // Mirrors the BFF's checks so the user hears about it before a 32 MB
    // round trip. The BFF still enforces both: this is for the wait, not for
    // the rule.
    if (file.size === 0) {
      setRejected(`"${file.name}" is empty.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setRejected(
        `"${file.name}" is ${formatSize(file.size)}. The limit is ${formatSize(MAX_BYTES)}.`,
      );
      return;
    }
    upload.mutate(file, {
      onSettled: () => {
        // Clear the input so the same file can be re-picked after a failure.
        if (inputRef.current) inputRef.current.value = '';
      },
    });
  };

  const items = data?.items ?? [];

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Paperclip className="size-4 text-ink-muted" aria-hidden />
            Attachments
            {items.length > 0 ? (
              <span className="text-[12px] font-normal text-ink-muted tabular-nums">
                {items.length}
              </span>
            ) : null}
          </p>

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              aria-label="Choose a file to attach"
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <Button
              size="sm"
              leadingIcon={<Upload className="size-4" />}
              loading={upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>

        {rejected ? (
          <p role="alert" className="mb-3 text-[12.5px] text-critical-ink">
            {rejected}
          </p>
        ) : null}

        {upload.isError ? (
          <p role="alert" className="mb-3 text-[12.5px] text-critical-ink">
            {(upload.error as Error).message}
          </p>
        ) : null}

        {upload.isSuccess && !upload.isPending ? (
          <p className="mb-3 text-[12.5px] text-good-ink">
            Uploaded {upload.data?.filename}.
          </p>
        ) : null}

        {isError ? (
          <p role="alert" className="text-[12.5px] text-critical-ink">
            Couldn’t load attachments. {error instanceof Error ? error.message : ''}
          </p>
        ) : isLoading ? (
          <Skeleton className="h-16" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No attachments yet"
            description="Upload a file to keep it with this record."
          />
        ) : (
          <ul className={cn('divide-y divide-line')}>
            {items.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                className={itopClass}
                id={id}
                canDelete={canDelete}
                {...(basePath ? { basePath } : {})}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
