/** Attachment metadata as the frontend sees it. Never the file bytes. */
export interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  /** Bytes of the decoded file, derived from iTop's base64 payload. */
  size: number;
  uploadedAt: string;
  /** The iTop user that owns the upload, when iTop reports one. */
  uploadedBy?: { id: string; name: string };
  /** How many times iTop has recorded a download. */
  downloads: number;
}

export interface AttachmentList {
  items: AttachmentDto[];
  total: number;
  /** The host object, echoed so a caller can confirm what it asked about. */
  item: { class: string; id: string };
}

/** A file on its way to iTop. */
export interface AttachmentUpload {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** Metadata plus the bytes, for a download. */
export interface AttachmentContent extends AttachmentDto {
  content: Buffer;
}
