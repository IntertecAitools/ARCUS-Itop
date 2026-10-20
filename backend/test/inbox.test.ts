import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAs, type Caller } from "../src/core/request-context.js";
import type { ItopClient } from "../src/itop/client.js";
import { InboxService } from "../src/platform/inbox/inbox.service.js";

interface Row {
  id: number;
  contact_id: number;
  read: "yes" | "no";
  title: string;
  message: string;
}

/** Answers the OQL the service sends from a small table, and records writes. */
function fakeItop(rows: Row[]) {
  const calls: Array<{ verb: string; params: Record<string, unknown>; asService: boolean }> = [];
  const client = {
    async call(verb: string, params: Record<string, unknown>, options: { asService?: boolean } = {}) {
      calls.push({ verb, params, asService: Boolean(options.asService) });
      if (verb === "core/update") {
        const row = rows.find((r) => r.id === params["key"]);
        Object.assign(row!, { read: (params["fields"] as { read: "yes" }).read });
        return { code: 0, message: "", objects: {} };
      }
      const oql = String(params["key"]);
      const contact = Number(/contact_id = (\d+)/.exec(oql)![1]);
      const id = / AND id = (\d+)$/.exec(oql)?.[1];
      let hits = rows.filter((r) => r.contact_id === contact);
      if (oql.includes("read = 'no'")) hits = hits.filter((r) => r.read === "no");
      if (id) hits = hits.filter((r) => r.id === Number(id));
      const limit = Number(params["limit"]);
      const page = Number(params["page"] ?? 1);
      const slice = hits.slice((page - 1) * limit, page * limit);
      return {
        code: 0,
        message: `Found: ${hits.length}`,
        objects: Object.fromEntries(
          slice.map((r) => [
            `EventNotificationNewsroom::${r.id}`,
            {
              code: 0,
              message: "",
              class: "EventNotificationNewsroom",
              key: String(r.id),
              fields: {
                id: String(r.id),
                title: r.title,
                message: r.message,
                priority: "3",
                read: r.read,
                date: "2026-10-20 10:00:00",
                object_class: "Incident",
                object_id: "9",
              },
            },
          ]),
        ),
      };
    },
  };
  return { client: client as unknown as ItopClient, calls, rows };
}

const caller = (contactId: number) => ({ userId: 1, login: "jane", contactId }) as Caller;

const ROWS = (): Row[] => [
  { id: 1, contact_id: 5, read: "yes", title: "I-1", message: "Old" },
  { id: 2, contact_id: 5, read: "no", title: "I-2", message: "<p>Assigned &amp; <b>urgent</b></p>" },
  { id: 3, contact_id: 5, read: "no", title: "I-3", message: "Newest" },
  { id: 4, contact_id: 8, read: "no", title: "Someone else's", message: "Private" },
];

describe("InboxService", () => {
  it("lists only the caller's own notifications, newest first, as plain text", async () => {
    const itop = fakeItop(ROWS());
    const inbox = new InboxService(itop.client, "UTC");
    const { items, unread } = await runAs(caller(5), () => inbox.list(2));
    assert.deepEqual(
      items.map((i) => i.id),
      [3, 2],
    );
    assert.equal(items[1]!.message, "Assigned & urgent");
    assert.deepEqual(items[0]!.record, { type: "Incident", id: 9 });
    assert.equal(unread, 2);
    assert.ok(itop.calls.every((c) => c.asService), "read with the service account");
  });

  it("will not mark someone else's notification read", async () => {
    const itop = fakeItop(ROWS());
    const inbox = new InboxService(itop.client, "UTC");
    await assert.rejects(() => runAs(caller(5), () => inbox.markRead(4)), /No notification 4/);
    assert.equal(itop.rows.find((r) => r.id === 4)!.read, "no");
  });

  it("marks one, then all, of the caller's notifications read", async () => {
    const itop = fakeItop(ROWS());
    const inbox = new InboxService(itop.client, "UTC");
    await runAs(caller(5), () => inbox.markRead(2));
    assert.equal(await runAs(caller(5), () => inbox.unreadCount()), 1);
    assert.equal(await runAs(caller(5), () => inbox.markAllRead()), 1);
    assert.equal(await runAs(caller(5), () => inbox.unreadCount()), 0);
    assert.equal(itop.rows.find((r) => r.id === 4)!.read, "no", "another person's stays unread");
  });

  it("is empty for an account with no linked person, without asking iTop", async () => {
    const itop = fakeItop(ROWS());
    const inbox = new InboxService(itop.client, "UTC");
    assert.deepEqual(await runAs(caller(0), () => inbox.list()), { items: [], unread: 0 });
    assert.equal(itop.calls.length, 0);
  });
});

describe("iTop times", () => {
  it("reads iTop's wall-clock text in its own time zone, daylight saving included", async () => {
    const { itopTimeToIso, toItopTime } = await import("../src/shared/itop-time.js");
    // Paris is UTC+2 in summer time (until 25 Oct 2026), UTC+1 after.
    assert.equal(itopTimeToIso("2026-10-20 14:04:17", "Europe/Paris"), "2026-10-20T12:04:17.000Z");
    assert.equal(itopTimeToIso("2026-11-20 14:04:17", "Europe/Paris"), "2026-11-20T13:04:17.000Z");
    assert.equal(itopTimeToIso("2026-10-20 14:04:17", "Asia/Kolkata"), "2026-10-20T08:34:17.000Z");
    assert.equal(itopTimeToIso("", "Europe/Paris"), "");
    assert.equal(toItopTime(new Date("2026-10-20T12:04:17Z"), "Europe/Paris"), "2026-10-20 14:04:17");
  });
});
