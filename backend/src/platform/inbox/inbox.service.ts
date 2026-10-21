import { notFound } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount, type FlatObject } from "../../itop/normalize.js";
import { itopTimeToIso, toItopTime } from "../../shared/itop-time.js";
import { newestRows } from "../objects/objects.service.js";
import { str } from "../../shared/ticket-mapping.js";

/**
 * The signed-in user's in-app notifications: iTop's newsroom.
 *
 * iTop's ActionNewsroom rules create one EventNotificationNewsroom per
 * recipient (a Contact). This service reads and marks the caller's own, so
 * the bell in our top bar shows what iTop's would.
 *
 * It runs as the service account, because ordinary profiles may not read
 * these events through REST, and is therefore the access control itself:
 * every query is pinned to the caller's own contact, and every write first
 * re-reads the notification under that pin.
 */

export interface InboxItem {
  id: number;
  title: string;
  message: string;
  /** An exact ISO instant (iTop's wall-clock time, converted from its time zone). */
  date: string;
  /** iTop's 1 (highest) to 4. */
  priority: "critical" | "high" | "medium" | "low";
  read: boolean;
  /** The record it is about, opened in this platform rather than iTop. */
  record: { type: string; id: number } | null;
}

const PRIORITY: Record<string, InboxItem["priority"]> = { "1": "critical", "2": "high", "3": "medium", "4": "low" };
const FIELDS = "id,title,message,priority,read,date,object_class,object_id";
/** Most a "mark all read" touches in one go. */
const MARK_ALL_LIMIT = 200;

function plain(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function toItem(row: FlatObject, timeZone: string): InboxItem {
  const f = row.fields;
  const objectId = Number(f["object_id"]);
  return {
    id: row.id,
    title: plain(str(f["title"])),
    message: plain(str(f["message"])),
    date: itopTimeToIso(str(f["date"]), timeZone) || str(f["date"]),
    priority: PRIORITY[str(f["priority"])] ?? "low",
    read: str(f["read"]) === "yes",
    record: objectId > 0 && str(f["object_class"]) ? { type: str(f["object_class"]), id: objectId } : null,
  };
}

export class InboxService {
  constructor(
    private readonly client: ItopClient,
    /** iTop's time zone: its dates are wall-clock text in it. */
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The caller's contact, or null when the account has no linked Person. */
  private contactId(): number | null {
    const id = currentCaller()?.contactId ?? 0;
    return id > 0 ? id : null;
  }

  private where(contactId: number, unreadOnly: boolean): string {
    return `SELECT EventNotificationNewsroom WHERE contact_id = ${contactId}${unreadOnly ? " AND read = 'no'" : ""}`;
  }

  private async get(oql: string, limit: number, page = 1) {
    return this.client.call(
      "core/get",
      { class: "EventNotificationNewsroom", key: oql, output_fields: FIELDS, limit, page },
      { asService: true },
    );
  }

  async unreadCount(): Promise<number> {
    const contactId = this.contactId();
    if (!contactId) return 0;
    const result = await this.get(this.where(contactId, true), 1);
    return parseFoundCount(result.message) ?? 0;
  }

  /** The newest `limit` notifications, newest first, and the unread count. */
  async list(limit = 30, unreadOnly = false): Promise<{ items: InboxItem[]; unread: number }> {
    const contactId = this.contactId();
    if (!contactId) return { items: [], unread: 0 };
    // iTop orders events newest first (date descending); newestRows() does
    // not depend on that, and reads two rounds at most however many there are.
    const oql = this.where(contactId, unreadOnly);
    const { rows, total } = await newestRows(limit, async (page, size) => {
      const result = await this.get(oql, size, page);
      return { rows: normalizeObjects(result.objects), total: parseFoundCount(result.message) ?? 0 };
    });
    const [items, unread] = await Promise.all([
      Promise.resolve(rows.map((row) => toItem(row, this.timeZone))),
      unreadOnly ? Promise.resolve(total) : this.unreadCount(),
    ]);
    return { items, unread };
  }

  /** Marks one of the caller's own notifications read; 404 for anyone else's. */
  async markRead(id: number): Promise<void> {
    const contactId = this.contactId();
    const found = contactId
      ? normalizeObjects((await this.get(`${this.where(contactId, false)} AND id = ${id}`, 1)).objects)[0]
      : undefined;
    if (!found) throw notFound(`No notification ${id}.`);
    if (str(found.fields["read"]) === "yes") return;
    await this.setRead(id);
  }

  /** Marks all of the caller's unread notifications read. */
  async markAllRead(): Promise<number> {
    const contactId = this.contactId();
    if (!contactId) return 0;
    const ids = normalizeObjects((await this.get(this.where(contactId, true), MARK_ALL_LIMIT)).objects).map((r) => r.id);
    // A few at a time: each is a write, with its own history entry, in iTop.
    for (let i = 0; i < ids.length; i += 5) {
      await Promise.all(ids.slice(i, i + 5).map((id) => this.setRead(id)));
    }
    return ids.length;
  }

  private async setRead(id: number): Promise<void> {
    await this.client.call(
      "core/update",
      {
        class: "EventNotificationNewsroom",
        key: id,
        fields: { read: "yes", read_date: toItopTime(this.now(), this.timeZone) },
        output_fields: "id",
        comment: `Notification read by ${currentCaller()?.login ?? "its recipient"} in the platform`,
      },
      { asService: true },
    );
  }
}
