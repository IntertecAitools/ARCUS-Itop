import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

/**
 * Attachments for one record, through the BFF.
 *
 * Everything here — including the file bytes — crosses the same boundary as
 * the rest of the app. The browser is never handed an iTop URL: that would
 * expose the backend's address and need its credentials to be useful.
 */

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  /** Bytes, decoded. iTop stores no size column; the BFF computes it. */
  size: number;
  uploadedAt: string;
  uploadedBy?: { id: string; name: string };
  downloads: number;
}

interface AttachmentList {
  items: Attachment[];
  total: number;
  item: { class: string; id: string };
}

const base = (className: string, id: string) => `/objects/${className}/${id}/attachments`;

const keyFor = (className: string, id: string) => ['attachments', className, id] as const;

export function useAttachments(className: string, id: string, enabled = true) {
  return useQuery({
    queryKey: keyFor(className, id),
    queryFn: () => apiClient.get<AttachmentList>(base(className, id)),
    enabled: enabled && Boolean(className && id),
  });
}

export function useUploadAttachment(className: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      // `file` is the part name the BFF reads.
      form.append('file', file, file.name);
      return apiClient.postForm<Attachment>(base(className, id), form);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keyFor(className, id) }),
  });
}

export function useDeleteAttachment(className: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiClient.delete<void>(`${base(className, id)}/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keyFor(className, id) }),
  });
}

/**
 * Downloads a file and hands it to the browser's save flow.
 *
 * Deliberately not a plain <a href> to the BFF: going through the api client
 * keeps credentials and error handling identical to every other call, so a
 * 403 or a 404 surfaces as a message instead of a downloaded error page.
 */
export function useDownloadAttachment(className: string, id: string) {
  return useMutation({
    mutationFn: async (attachment: Attachment) => {
      const blob = await apiClient.getBlob(`${base(className, id)}/${attachment.id}`);

      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.filename;
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        // Revoking immediately can cancel the download in some browsers, so
        // this waits a tick; not revoking at all leaks the blob for the
        // lifetime of the document.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    },
  });
}
