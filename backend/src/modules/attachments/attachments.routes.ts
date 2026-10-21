import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { badRequest, AppError } from "../../core/errors.js";
import { identifierParam, idParam, parse } from "../../core/validate.js";
import type { Services } from "../../services.js";
import { MAX_UPLOAD_BYTES } from "./attachments.service.js";
import type { AttachmentContent, AttachmentUpload } from "./attachments.types.js";

/**
 * Attachment endpoints, hung off the object they belong to.
 *
 * The host object is in the path rather than the body on purpose: an
 * attachment only means anything in the context of its ticket, and routing it
 * that way makes the ownership check unavoidable instead of optional.
 */

const itemParams = z.object({ class: identifierParam, id: idParam });
const attachmentParams = itemParams.extend({ attachmentId: idParam });

/**
 * Filename for the Content-Disposition header.
 *
 * Strips anything that could change where the file lands or how the header
 * parses: path separators (traversal), control characters and quotes. The
 * original is also sent RFC 5987-encoded so non-ASCII names survive.
 */
function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "attachment";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "attachment";
}

/**
 * RFC 5987 ext-value. encodeURIComponent leaves ' ( ) * as they are, and an
 * apostrophe is the ext-value delimiter, so a name like "O'Brien.pdf" would
 * otherwise end the value early.
 */
function rfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Reads a multipart upload's `file` part, refusing what is malformed or over
 * MAX_UPLOAD_BYTES. Shared by the staff and the self-service routes.
 */
export async function readUpload(request: FastifyRequest): Promise<AttachmentUpload> {
  if (!request.isMultipart()) {
    throw new AppError(
      "unsupported_media_type",
      "Upload a file as multipart/form-data with a `file` part.",
    );
  }

  let file;
  try {
    file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
  } catch (error) {
    // Thrown by the multipart parser for a malformed body.
    throw badRequest(`That upload could not be read: ${(error as Error).message}`);
  }

  if (!file) {
    throw badRequest("The request contained no file part.");
  }

  let content: Buffer;
  try {
    content = await file.toBuffer();
  } catch (error) {
    // Depending on its options the parser either throws here or truncates
    // quietly, so both are handled. Letting the throw escape would report an
    // oversized file as a generic 500 with no usable message.
    const code = (error as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE" || /file too large/i.test(String(error))) {
      throw new AppError(
        "payload_too_large",
        `That file is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
        { details: { maxBytes: MAX_UPLOAD_BYTES } },
      );
    }
    throw badRequest(`That upload could not be read: ${(error as Error).message}`);
  }

  // And the truncating case: storing a silently cut-short file is worse than
  // refusing it.
  if (file.file.truncated) {
    throw new AppError(
      "payload_too_large",
      `That file is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
      { details: { maxBytes: MAX_UPLOAD_BYTES } },
    );
  }

  return {
    filename: safeFilename(file.filename ?? "attachment"),
    // Browsers omit the type for unknown extensions; iTop stores whatever it
    // is given, so default rather than reject.
    mimeType: file.mimetype || "application/octet-stream",
    content,
  };
}

/**
 * The Content-Type to serve. The stored type is whatever the uploader's
 * browser declared, so anything a browser could run as a page or script
 * (HTML, SVG, XML, JavaScript) -- or that is not a plain type at all -- goes
 * out as opaque bytes. With `attachment` and nosniff that is belt and braces,
 * but it keeps a future "open in a tab" from becoming stored XSS.
 */
export function servedMimeType(declared: string): string {
  const type = declared.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type.split(";")[0]!.trim())) {
    return "application/octet-stream";
  }
  if (/html|xml|svg|javascript|ecmascript|^text\/(css|x-component)/.test(type)) return "application/octet-stream";
  return declared.trim();
}

/** Sends an attachment as a download, never rendered in our origin. */
export function sendAttachment(reply: FastifyReply, file: AttachmentContent) {
  const filename = safeFilename(file.filename);
  // filename= takes Latin-1 at most (Node refuses anything else in a
  // header), so it gets an ASCII stand-in; filename* carries the real name.
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "_");
  reply
    .header("Content-Type", servedMimeType(file.mimeType))
    .header("Content-Length", String(file.content.byteLength))
    // `attachment` so the browser saves rather than renders: an uploaded
    // .html or .svg rendered inline would execute in our origin.
    .header(
      "Content-Disposition",
      `attachment; filename="${asciiName}"; filename*=UTF-8''${rfc5987(filename)}`,
    )
    .header("X-Content-Type-Options", "nosniff");

  return reply.send(file.content);
}

export function registerAttachmentRoutes(app: FastifyInstance, services: Services): void {
  const { attachments } = services;

  app.get("/api/objects/:class/:id/attachments", async (request) => {
    const params = parse(itemParams, request.params, "path parameters");
    return attachments.list(params.class, String(params.id));
  });

  /**
   * Upload.
   *
   * multipart/form-data in, because that is what a browser sends for a file
   * and base64 in JSON would inflate the request by a third for no gain.
   * iTop's REST API has no multipart endpoint, so the service converts.
   */
  app.post("/api/objects/:class/:id/attachments", async (request, reply) => {
    const params = parse(itemParams, request.params, "path parameters");

    const upload = await readUpload(request);
    const created = await attachments.upload(params.class, String(params.id), upload);

    reply.code(201);
    return created;
  });

  /**
   * Download.
   *
   * Served through the BFF rather than by handing the browser an iTop URL:
   * that would leak the backend's address and its credentials along with it.
   */
  app.get("/api/objects/:class/:id/attachments/:attachmentId", async (request, reply) => {
    const params = parse(attachmentParams, request.params, "path parameters");
    const file = await attachments.download(
      params.class,
      String(params.id),
      String(params.attachmentId),
    );

    return sendAttachment(reply, file);
  });

  app.delete("/api/objects/:class/:id/attachments/:attachmentId", async (request, reply) => {
    const params = parse(attachmentParams, request.params, "path parameters");
    await attachments.remove(params.class, String(params.id), String(params.attachmentId));
    reply.code(204);
    return null;
  });
}
