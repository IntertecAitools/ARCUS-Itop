'use client';

import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';

export interface FileUploadProps {
  id: string;
  onFiles: (files: File[]) => void;
  /** Called for files over the size limit */
  onReject?: (file: File) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeBytes?: number;
  disabled?: boolean;
  busy?: boolean;
}

export function FileUpload({
  id,
  onFiles,
  onReject,
  accept,
  multiple = true,
  maxSizeBytes = 10 * 1024 * 1024,
  disabled,
  busy,
}: FileUploadProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);

  function handle(list: FileList | null) {
    if (!list) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      if (file.size > maxSizeBytes) onReject?.(file);
      else accepted.push(file);
    }
    if (accepted.length) onFiles(accepted);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) handle(event.dataTransfer.files);
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors',
        'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
        dragging ? 'border-primary bg-primary-soft' : 'border-border bg-surface-muted',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary',
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden>
        <Upload className="size-5" />
      </span>
      <span className="text-sm font-medium text-text">{busy ? t('upload.uploading') : t('upload.prompt')}</span>
      <span className="text-xs text-text-muted">{t('upload.limit', { size: formatBytes(maxSizeBytes) })}</span>
      <input
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled || busy}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}
