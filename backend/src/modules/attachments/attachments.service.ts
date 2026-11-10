import { badRequest, notFound } from "../../core/errors.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import type { ObjectDto, ObjectsService } from "../../platform/objects/objects.service.js";
import { oqlString, str } from "../../shared/ticket-mapping.js";
import type {
  AttachmentContent,
  AttachmentDto,
  AttachmentList,
  AttachmentUpload,
} from "./attachments.types.js";

/**
 * Attachments, as iTop actually implements them.
 *
 * Verified against the installed instance rather than assumed:
 *
 *  - `Attachment` is a standalone class, NOT a LinkedSet on tickets. It points
 *    back at its host polymorphically through `item_class` + `item_id`, which
 *    is why no class carries an `attachments` field and why attachments are
 *    absent from the presentation metadata.
 *  - iTop's own code lists them with
 *    `SELECT Attachment WHERE item_class = :class AND item_id = :item_id`
 *    (itop-attachments/main.itop-attachments.php). Same query here.
 *  - `contents` is an AttributeBlob. Over REST it is base64 inside JSON:
 *    `{data, mimetype, filename, downloads_count}` both ways
 *    (sources/Core/AttributeDefinition/AttributeBlob.php). There is no
 *    multipart endpoint on iTop's REST API, so the BFF accepts multipart from
 *    the browser -- the efficient, standard thing there -- and converts.
 *  - iTop sets `creation_date`, `expire`, `user_id` and `contact_id` itself
 *    on create, the last two from the authenticated REST account -- but only
 *    when they are empty (Attachment::DBInsertNoReload uses SetIfNull). So an
 *    upload made through the service account for someone else (the portal)
 *    sends that person's user and contact, and iTop records them as the
 *    uploader; its own attachment list shows `contact_id`.
 *  - `item_org_id` is the organisation iTop's data silos filter attachments
 *    on (Attachment::MapContextParam maps org_id to it), and so does our
 *    tenancy (platform/tenancy/scope-rules.ts). iTop fills it only in its own
 *    screens (SetItem, SetDefaultOrgId), never on a REST create. Left empty,
 *    every user limited to some organisations stops seeing the file: only
 *    administrators, who have no such limit, still do. So an upload sends its
 *    ticket's org_id, and repairMissingOrgs() fills the ones made before.
 */

/** iTop's `itop-attachments/allowed_classes`, verified in config-itop.php. */
const ALLOWED_ROOT_CLASS = "Ticket";

/**
 * Hard ceiling on an upload, derived from the instance rather than invented.
 *
 * PHP reports post_max_size = 50M on this iTop. The REST payload is base64, so
 * it inflates the file by 4/3 before the JSON envelope is added. 32 MiB of file
 * becomes ~43 MB of base64 and still leaves room for the rest of the request.
 * iTop remains the real authority; this fails fast with a clear message rather
 * than letting PHP truncate the body and return something unhelpful.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Fields to read back.
 *
 * `user_id_friendlyname` is iTop's resolved display name for the uploader --
 * requested explicitly, because iTop only returns it when asked, and without
 * it the uploader renders as a bare numeric id dressed up as a name.
 */
const METADATA_FIELDS =
  "id,item_class,item_id,creation_date,user_id,user_id_friendlyname,contact_id,contact_id_friendlyname,contents";

/** Who an upload is recorded under, when it is not the account calling iTop. */
export interface Uploader {
  userId: number;
  /** Their Person; 0 when the account has none. */
  contactId: number;
  login: string;
}

export class AttachmentsService {
  constructor(
    private readonly objects: ObjectsService,
    private readonly schema: CmdbSchema,
    /** For the repair, which reads and writes as the service account. */
    private readonly client?: ItopClient,
  ) {}

  /**
   * Rejects a host class iTop would not attach to.
   *
   * iTop's allowed_classes is `['Ticket']`, which means Ticket and everything
   * below it. Checking the inheritance chain rather than a hardcoded list of
   * ticket classes means installing a new ticket module works without a code
   * change here.
   */
  private assertAttachable(itemClass: string): void {
    const info = this.schema.require(itemClass);
    const isTicket = itemClass === ALLOWED_ROOT_CLASS || info.inherits.includes(ALLOWED_ROOT_CLASS);
    if (!isTicket) {
      throw badRequest(
        `iTop does not accept attachments on ${itemClass}. ` +
          `Its itop-attachments configuration allows ${ALLOWED_ROOT_CLASS} and its subclasses.`,
      );
    }
  }

  /** Does this class name its organisation in org_id (every ticket class does)? */
  private hasOrg(itemClass: string): boolean {
    return Boolean(this.schema.require(itemClass).fields["org_id"]);
  }

  /**
   * Confirms the host row exists, so an upload cannot be orphaned, and
   * answers its organisation (0 when it has none) for `item_org_id`.
   */
  private async itemOrg(itemClass: string, itemId: string): Promise<number> {
    const withOrg = this.hasOrg(itemClass);
    const found = await this.objects.list(itemClass, {
      page: 1,
      limit: 1,
      oql: `SELECT ${itemClass} WHERE id = ${Number(itemId)}`,
      fields: withOrg ? "id,org_id" : "id",
    });
    const row = found.items[0];
    if (!row) {
      throw notFound(`${itemClass} ${itemId} was not found.`);
    }
    return withOrg ? Number(row.fields["org_id"] ?? 0) || 0 : 0;
  }

  private assertValidId(itemId: string): void {
    // Interpolated into OQL below, so this is also the injection guard.
    if (!/^\d+$/.test(itemId)) {
      throw badRequest(`"${itemId}" is not a valid object id.`);
    }
  }

  /**
   * Decodes iTop's Blob payload into metadata.
   *
   * `size` is computed from the decoded bytes because iTop does not store a
   * size column -- reporting anything else would be inventing a number.
   */
  private toDto(row: ObjectDto, options: { withContent?: boolean } = {}) {
    const contents = row.fields["contents"] as
      | { data?: string; mimetype?: string; filename?: string; downloads_count?: number }
      | null
      | undefined;

    const base64 = typeof contents?.data === "string" ? contents.data : "";
    const content = Buffer.from(base64, "base64");
    const userId = str(row.fields["user_id"]);
    // iTop's own list names the contact; a user without one names the account.
    const name = str(row.fields["contact_id_friendlyname"]) || str(row.fields["user_id_friendlyname"]);

    const dto: AttachmentDto = {
      id: String(row.id),
      filename: contents?.filename || `attachment-${row.id}`,
      mimeType: contents?.mimetype || "application/octet-stream",
      size: content.byteLength,
      uploadedAt: str(row.fields["creation_date"]),
      downloads: Number(contents?.downloads_count ?? 0),
      // Only claim an uploader when iTop resolved a name for it. Falling back
      // to the id would present "1" as a person's name.
      ...(userId && userId !== "0" && name ? { uploadedBy: { id: userId, name } } : {}),
    };

    return options.withContent ? { ...dto, content } : dto;
  }

  async list(itemClass: string, itemId: string): Promise<AttachmentList> {
    this.assertValidId(itemId);
    this.assertAttachable(itemClass);

    const result = await this.objects.list("Attachment", {
      page: 1,
      limit: 200,
      // iTop's own query for this, parameters inlined as literals. item_class
      // is a schema class name validated above; item_id is digits-only.
      oql:
        `SELECT Attachment WHERE item_class = '${oqlString(itemClass)}' ` +
        `AND item_id = ${Number(itemId)}`,
      fields: METADATA_FIELDS,
    });

    return {
      items: result.items
        .map((row) => this.toDto(row) as AttachmentDto)
        .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
      total: result.total,
      item: { class: itemClass, id: itemId },
    };
  }

  async upload(
    itemClass: string,
    itemId: string,
    file: AttachmentUpload,
    onBehalfOf?: Uploader,
  ): Promise<AttachmentDto> {
    this.assertValidId(itemId);
    this.assertAttachable(itemClass);

    if (file.content.byteLength === 0) {
      throw badRequest("That file is empty.");
    }
    if (file.content.byteLength > MAX_UPLOAD_BYTES) {
      throw badRequest(
        `That file is ${Math.round(file.content.byteLength / 1024 / 1024)} MB. ` +
          `The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        { maxBytes: MAX_UPLOAD_BYTES, size: file.content.byteLength },
      );
    }

    const orgId = await this.itemOrg(itemClass, itemId);

    const created = await this.objects.create(
      "Attachment",
      {
        item_class: itemClass,
        item_id: itemId,
        contents: {
          data: file.content.toString("base64"),
          mimetype: file.mimeType,
          filename: file.filename,
          downloads_count: 0,
        },
        ...(orgId > 0 ? { item_org_id: orgId } : {}),
        ...(onBehalfOf && onBehalfOf.userId > 0 ? { user_id: onBehalfOf.userId } : {}),
        ...(onBehalfOf && onBehalfOf.contactId > 0 ? { contact_id: onBehalfOf.contactId } : {}),
      },
      {
        fields: METADATA_FIELDS,
        comment: onBehalfOf
          ? `Attached ${file.filename} for ${onBehalfOf.login} in the self-service portal`
          : `Attached ${file.filename}`,
      },
    );

    return this.toDto(created.object) as AttachmentDto;
  }

  /**
   * Fills `item_org_id` on attachments uploaded without it (through the REST
   * API, before this was set on upload), from the ticket each is attached to.
   * Runs as the service account, since the users who cannot see these files
   * are exactly the ones who could not repair them. Safe to run again: it
   * only touches attachments whose organisation is still empty.
   */
  async repairMissingOrgs(): Promise<{ checked: number; repaired: number }> {
    if (!this.client) return { checked: 0, repaired: 0 };
    const client = this.client;
    const rows = async (cls: string, oql: string, fields: string) =>
      normalizeObjects(
        (await client.call("core/get", { class: cls, key: oql, output_fields: fields }, { asService: true })).objects,
      );

    const orphans = await rows(
      "Attachment",
      "SELECT Attachment WHERE ISNULL(item_org_id) OR item_org_id = 0",
      "item_class,item_id",
    );
    const byClass = new Map<string, number[]>();
    for (const a of orphans) {
      const cls = str(a.fields["item_class"]);
      const id = Number(a.fields["item_id"]);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(cls) || !(id > 0) || !this.schema.get(cls) || !this.hasOrg(cls)) continue;
      byClass.set(cls, [...(byClass.get(cls) ?? []), id]);
    }

    const orgOf = new Map<string, number>();
    for (const [cls, ids] of byClass) {
      const unique = [...new Set(ids)];
      for (let i = 0; i < unique.length; i += 200) {
        const chunk = unique.slice(i, i + 200);
        for (const host of await rows(cls, `SELECT ${cls} WHERE id IN (${chunk.join(",")})`, "org_id")) {
          orgOf.set(`${cls}:${host.id}`, Number(host.fields["org_id"] ?? 0) || 0);
        }
      }
    }

    let repaired = 0;
    for (const a of orphans) {
      const org = orgOf.get(`${str(a.fields["item_class"])}:${Number(a.fields["item_id"])}`) ?? 0;
      if (org <= 0) continue;
      await client.call(
        "core/update",
        {
          class: "Attachment",
          key: a.id,
          fields: { item_org_id: org },
          comment: "Attachment organisation set from its ticket",
          output_fields: "id",
        },
        { asService: true },
      );
      repaired += 1;
    }
    return { checked: orphans.length, repaired };
  }

  /** Metadata plus bytes. Separate from list() so listing stays cheap. */
  async download(
    itemClass: string,
    itemId: string,
    attachmentId: string,
  ): Promise<AttachmentContent> {
    const row = await this.requireAttachment(itemClass, itemId, attachmentId);
    return this.toDto(row, { withContent: true }) as AttachmentContent;
  }

  async remove(itemClass: string, itemId: string, attachmentId: string): Promise<void> {
    const row = await this.requireAttachment(itemClass, itemId, attachmentId);
    await this.objects.remove("Attachment", row.id, {
      simulate: false,
      comment: `Removed attachment ${attachmentId}`,
    });
  }

  /**
   * Loads one attachment, scoped to its host object.
   *
   * The host is part of the lookup rather than decoration: without it,
   * `/objects/Incident/1/attachments/99` would happily return an attachment
   * belonging to a different ticket, which is an access-control hole dressed
   * up as a 200.
   */
  private async requireAttachment(
    itemClass: string,
    itemId: string,
    attachmentId: string,
  ): Promise<ObjectDto> {
    this.assertValidId(itemId);
    this.assertValidId(attachmentId);
    this.assertAttachable(itemClass);

    const result = await this.objects.list("Attachment", {
      page: 1,
      limit: 1,
      oql:
        `SELECT Attachment WHERE id = ${Number(attachmentId)} ` +
        `AND item_class = '${oqlString(itemClass)}' AND item_id = ${Number(itemId)}`,
      fields: METADATA_FIELDS,
    });

    const row = result.items[0];
    if (!row) {
      throw notFound(`Attachment ${attachmentId} was not found on ${itemClass} ${itemId}.`);
    }
    return row;
  }
}
