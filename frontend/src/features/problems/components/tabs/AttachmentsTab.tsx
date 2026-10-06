'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { Card } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FileUpload } from '@/components/forms';
import { ConfirmDialog } from '@/components/overlays';
import { Button } from '@/components/ui';
import { base64ToBlob, downloadFile, formatBytes, formatDateTime, readFileAsBase64 } from '@/lib/utils';
import { toast } from '@/stores';
import { fetchAttachmentContents, useDeleteAttachment, useProblemAttachments, useUploadAttachment } from '../../api/problems';
import type { Problem, ProblemAttachment } from '../../types';

const MAX_SIZE = 10 * 1024 * 1024;

export function AttachmentsTab({ problem, canEdit }: { problem: Problem; canEdit: boolean }) {
  const { t } = useTranslation('problems');
  const { t: tc } = useTranslation();
  const { data, isLoading } = useProblemAttachments(problem.id);
  const upload = useUploadAttachment(problem.id);
  const remove = useDeleteAttachment(problem.id);
  const [toDelete, setToDelete] = useState<ProblemAttachment | null>(null);

  async function onFiles(files: File[]) {
    for (const file of files) {
      try {
        const data64 = await readFileAsBase64(file);
        await upload.mutateAsync({ filename: file.name, mimetype: file.type || 'application/octet-stream', data: data64 });
        toast.success(t('attachments.uploaded', { name: file.name }));
      } catch {
        // reported by the global toast
      }
    }
  }

  async function onDownload(att: ProblemAttachment) {
    try {
      const contents = await fetchAttachmentContents(problem.id, att.id);
      downloadFile(contents.filename, base64ToBlob(contents.data, contents.mimetype), contents.mimetype);
    } catch (error) {
      toast.error(t('attachments.downloadFailed'), error instanceof Error ? error.message : undefined);
    }
  }

  const attachments = data ?? [];

  return (
    <Card title={t('attachments.title')}>
      {canEdit && (
        <div className="mb-5">
          <FileUpload
            id="problem-attachment"
            maxSizeBytes={MAX_SIZE}
            busy={upload.isPending}
            onFiles={onFiles}
            onReject={(file) => toast.error(t('attachments.tooLarge', { name: file.name, size: formatBytes(MAX_SIZE) }))}
          />
        </div>
      )}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : attachments.length === 0 ? (
        <EmptyState icon={Paperclip} title={t('attachments.emptyTitle')} description={t('attachments.emptyDescription')} />
      ) : (
        <ul className="divide-y divide-border rounded-control border border-border">
          {attachments.map((att) => (
            <li key={att.id} className="flex items-center gap-3 px-4 py-3">
              <Paperclip className="size-4 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{att.filename}</p>
                <p className="text-xs text-text-muted">
                  {formatBytes(att.size)} · {formatDateTime(att.creation_date)}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={t('attachments.download', { name: att.filename })} onClick={() => onDownload(att)}>
                <Download className="size-4" aria-hidden />
              </Button>
              {canEdit && (
                <Button variant="ghost" size="icon" aria-label={t('attachments.delete', { name: att.filename })} onClick={() => setToDelete(att)}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title={t('attachments.deleteTitle')}
        description={t('attachments.deleteDescription', { name: toDelete?.filename })}
        confirmLabel={tc('actions.delete')}
        cancelLabel={tc('actions.cancel')}
        tone="danger"
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />
    </Card>
  );
}
