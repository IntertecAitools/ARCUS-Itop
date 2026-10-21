import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { DashboardService } from "../src/modules/dashboard/dashboard.service.js";
import { NotificationsService } from "../src/platform/admin/notifications.service.js";
import { HistoryService } from "../src/platform/history/history.service.js";
import { criterionToOql } from "../src/platform/objects/criteria.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { PortalService } from "../src/platform/portal/portal.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import {
  addDays,
  isoToItopTime,
  itopDay,
  itopFieldsToIso,
  weekday,
} from "../src/shared/itop-time.js";
import { oqlDate, toTicket } from "../src/shared/ticket-mapping.js";
import { validateWrite } from "../src/shared/write-validation.js";
import type { Caller } from "../src/core/request-context.js";
import { FakeItopClient, getResponse, SAMPLE_RAW_SCHEMA } from "./helpers.js";

/**
 * iTop stores datetimes as wall-clock text on its own clock (Europe/Paris
 * here). Every path that reads one must hand the browser an exact instant,
 * and every path that writes or filters must go back to iTop's clock.
 *
 * 20 Oct 2026 Paris is CEST (UTC+2); 1 Dec 2026 is CET (UTC+1).
 */
const PARIS = "Europe/Paris";

const schema = CmdbSchema.fromRaw({
  ...SAMPLE_RAW_SCHEMA,
  UserRequest: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject", "Ticket"],
    lifecycle: null,
    writable: ["title", "start_date", "due_date"],
    readonly: [],
    fields: {
      ref: { type: "String", ui: "scalar", owner: "Ticket" },
      title: { type: "String", ui: "scalar", owner: "Ticket" },
      status: { type: "Enum", ui: "scalar", owner: "UserRequest", values: ["new", "assigned", "resolved"] },
      operational_status: { type: "Enum", ui: "scalar", owner: "Ticket", values: ["ongoing", "closed"] },
      start_date: { type: "DateTime", ui: "scalar", owner: "Ticket" },
      last_update: { type: "DateTime", ui: "scalar", owner: "Ticket" },
      resolution_date: { type: "DateTime", ui: "scalar", owner: "UserRequest" },
      close_date: { type: "DateTime", ui: "scalar", owner: "Ticket" },
      due_date: { type: "Date", ui: "scalar", owner: "UserRequest" },
      public_log: { type: "CaseLog", ui: "scalar", owner: "UserRequest" },
      tto_escalation_deadline: { type: "SubItem", ui: "scalar", owner: "UserRequest" },
      tto_timespent: { type: "SubItem", ui: "scalar", owner: "UserRequest" },
    },
  },
});

describe("itop-time helpers", () => {
  it("converts DateTime and case-log dates, leaves Date-only and other fields alone", () => {
    const out = itopFieldsToIso(
      {
        title: "2026-10-20 14:04:17",
        start_date: "2026-10-20 14:04:17",
        close_date: "",
        due_date: "2026-10-21",
        public_log: { entries: [{ date: "2026-12-01 09:00:00", user_login: "jane", message: "hi" }] },
        tto_escalation_deadline: "2026-10-20 16:00:00",
        tto_timespent: "3600",
      },
      schema.require("UserRequest"),
      PARIS,
    );
    assert.equal(out["start_date"], "2026-10-20T12:04:17.000Z");
    assert.equal(out["title"], "2026-10-20 14:04:17", "a String that looks like a date is untouched");
    assert.equal(out["close_date"], "");
    assert.equal(out["due_date"], "2026-10-21");
    assert.equal(out["tto_escalation_deadline"], "2026-10-20T14:00:00.000Z");
    assert.equal(out["tto_timespent"], "3600");
    assert.deepEqual(out["public_log"], {
      entries: [{ date: "2026-12-01T08:00:00.000Z", user_login: "jane", message: "hi" }],
    });
  });

  it("reads exact instants onto iTop's clock and rejects wall-clock text", () => {
    assert.equal(isoToItopTime("2026-10-20T08:34:00.000Z", PARIS), "2026-10-20 10:34:00");
    assert.equal(isoToItopTime("2026-10-20T14:04:00+05:30", PARIS), "2026-10-20 10:34:00");
    assert.equal(isoToItopTime("2026-10-20 10:34:00", PARIS), null);
    assert.equal(isoToItopTime("2026-10-20T10:34", PARIS), null);
  });

  it("does day arithmetic on iTop's calendar", () => {
    // 22:30 UTC on 20 Oct is already 21 Oct in Paris.
    assert.equal(itopDay(new Date("2026-10-20T22:30:00Z"), PARIS), "2026-10-21");
    assert.equal(addDays("2026-10-01", -1), "2026-09-30");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(weekday("2026-10-20"), 2); // a Tuesday
  });

  it("builds OQL literals on iTop's clock, not the BFF host's", () => {
    assert.equal(oqlDate(new Date("2026-10-20T08:34:00Z"), PARIS), "2026-10-20 10:34:00");
    assert.equal(oqlDate(new Date("2026-10-20T08:34:00Z"), "Asia/Kolkata"), "2026-10-20 14:04:00");
  });
});

describe("ObjectsService dates", () => {
  const record = getResponse([
    {
      class: "UserRequest",
      id: 5,
      fields: {
        ref: "R-5",
        title: "Printer",
        status: "new",
        start_date: "2026-10-20 14:04:17",
        due_date: "2026-10-21",
        public_log: { entries: [{ date: "2026-10-20 14:05:00", user_login: "jane", message: "x" }] },
      },
    },
  ]);

  it("returns DateTime fields and case-log dates as ISO instants", async () => {
    const fake = new FakeItopClient().on("core/get", record);
    const dto = await new ObjectsService(fake.asClient(), schema, "t", PARIS).get("UserRequest", 5);
    assert.equal(dto.fields["start_date"], "2026-10-20T12:04:17.000Z");
    assert.equal(dto.fields["due_date"], "2026-10-21");
    const log = dto.fields["public_log"] as { entries: { date: string }[] };
    assert.equal(log.entries[0]?.date, "2026-10-20T12:05:00.000Z");
  });

  it("honours iTop's configured zone", async () => {
    const fake = new FakeItopClient().on("core/get", record);
    const dto = await new ObjectsService(fake.asClient(), schema, "t", "Asia/Kolkata").get("UserRequest", 5);
    assert.equal(dto.fields["start_date"], "2026-10-20T08:34:17.000Z");
  });

  it("feeds toTicket an instant, so the ticket list's createdAt is exact", async () => {
    const fake = new FakeItopClient().on("core/get", record);
    const dto = await new ObjectsService(fake.asClient(), schema, "t", PARIS).get("UserRequest", 5);
    assert.equal(toTicket(dto).createdAt, "2026-10-20T12:04:17.000Z");
  });

  it("writes an ISO instant as iTop wall-clock text; Date and wall-clock text unchanged", async () => {
    const fake = new FakeItopClient().on("core/create", record);
    await new ObjectsService(fake.asClient(), schema, "t", PARIS).create("UserRequest", {
      title: "x",
      start_date: "2026-10-20T08:34:00.000Z",
      due_date: "2026-10-21",
    });
    const fields = fake.lastCall().params["fields"] as Record<string, unknown>;
    assert.equal(fields["start_date"], "2026-10-20 10:34:00");
    assert.equal(fields["due_date"], "2026-10-21");

    const info = schema.require("UserRequest");
    const wall = validateWrite(info, { start_date: "2026-10-20T10:34" }, { mode: "update", timeZone: PARIS });
    assert.equal(wall.fields["start_date"], "2026-10-20 10:34:00");
  });

  it("filters on an instant in iTop's zone, and a bare day as iTop's day", () => {
    const info = schema.require("UserRequest");
    assert.equal(
      criterionToOql(info, { field: "start_date", op: "gte", value: "2026-10-20T08:34:00Z" }, PARIS),
      "start_date >= '2026-10-20 10:34:00'",
    );
    assert.equal(
      criterionToOql(info, { field: "start_date", op: "equals", value: "2026-10-20" }, PARIS),
      "(start_date >= '2026-10-20 00:00:00' AND start_date <= '2026-10-20 23:59:59')",
    );
  });
});

describe("PortalService dates", () => {
  const jane: Caller = {
    userId: 30,
    login: "jane",
    contactId: 7,
    name: "Jane Doe",
    email: "",
    kind: "portal",
    profiles: ["Portal user"],
    isAdmin: false,
    allowedOrgIds: [],
    orgId: 3,
  };

  it("returns createdAt, updatedAt, resolvedAt and log dates as instants", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([
        {
          class: "UserRequest",
          id: 5,
          fields: {
            ref: "R-5",
            status: "resolved",
            operational_status: "ongoing",
            start_date: "2026-10-20 14:04:17",
            last_update: "2026-12-01 09:00:00",
            resolution_date: "2026-12-01 09:00:00",
            close_date: "",
            public_log: { entries: [{ date: "2026-10-20 14:05:00", user_login: "agent", message: "On it" }] },
          },
        },
      ]),
    );
    const objects = new ObjectsService(fake.asClient(), schema, "t", PARIS);
    const portal = new PortalService(fake.asClient(), schema, objects);

    const detail = await portal.getTicket(jane, 5);
    assert.equal(detail.createdAt, "2026-10-20T12:04:17.000Z");
    assert.equal(detail.updatedAt, "2026-12-01T08:00:00.000Z");
    assert.equal(detail.resolvedAt, "2026-12-01T08:00:00.000Z");
    assert.equal(detail.closedAt, "");
    assert.equal(detail.log[0]?.date, "2026-10-20T12:05:00.000Z");

    const list = await portal.listTickets(jane, { closed: false, page: 1, limit: 10 });
    assert.equal(list.items[0]?.createdAt, "2026-10-20T12:04:17.000Z");
  });
});

describe("HistoryService dates", () => {
  it("returns the save's date and DateTime changes as instants", async () => {
    const fake = new FakeItopClient().on("core/get", [
      getResponse([{ class: "UserRequest", id: 5, fields: {} }]),
      getResponse([
        {
          class: "CMDBChangeOpSetAttributeScalar",
          id: 1,
          fields: {
            change: "9",
            date: "2026-10-20 14:04:17",
            userinfo: "Jane",
            attcode: "start_date",
            oldvalue: "",
            newvalue: "2026-12-01 09:00:00",
          },
        },
      ]),
    ]);
    const history = await new HistoryService(fake.asClient(), schema, PARIS).forObject("UserRequest", 5);
    const entry = history.items[0]!;
    assert.equal(entry.date, "2026-10-20T12:04:17.000Z");
    assert.equal(entry.changes[0]?.valueKind, "datetime");
    assert.equal(entry.changes[0]?.oldValue, "");
    assert.equal(entry.changes[0]?.newValue, "2026-12-01T08:00:00.000Z");
  });
});

describe("NotificationsService.sent dates", () => {
  it("returns each send's date as an instant", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([
        {
          class: "EventNotificationEmail",
          id: 3,
          fields: { date: "2026-10-20 14:04:17", to: "a@b.c", subject: "s", message: "Sent", object_id: "0" },
        },
      ]),
    );
    const sent = await new NotificationsService(fake.asClient(), schema, undefined, undefined, PARIS).sent();
    assert.equal(sent[0]?.date, "2026-10-20T12:04:17.000Z");
  });
});

describe("DashboardService dates", () => {
  afterEach(() => mock.timers.reset());

  function objectsStub(rows: Record<string, { class: string; id: number; label: string; fields: Record<string, unknown> }[]>) {
    const oql: string[] = [];
    const page = (className: string, query: { oql: string }) => {
      oql.push(query.oql);
      const items = rows[className] ?? [];
      return { items, total: items.length, page: 1, limit: 500, pages: 1, hasMore: false };
    };
    const objects = {
      timeZone: PARIS,
      async list(className: string, query: { oql: string }) {
        return page(className, query);
      },
      async listAll(className: string, query: { oql: string }) {
        return page(className, query);
      },
    } as unknown as ObjectsService;
    return { objects, oql };
  }

  it("cuts ranges and trend days on iTop's calendar", async () => {
    // 22:30 UTC Tue 20 Oct = 00:30 Wed 21 Oct in Paris.
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T22:30:00Z") });
    const incident = (id: number, start: string) => ({
      class: "Incident",
      id,
      label: `I-${id}`,
      fields: { ref: `I-${id}`, status: "new", priority: "3", start_date: start, resolution_date: "" },
    });
    const { objects, oql } = objectsStub({
      // 00:15 on 21 Oct Paris, still 20 Oct in UTC.
      Incident: [incident(1, "2026-10-20T22:15:00.000Z")],
      Change: [{ class: "Change", id: 2, label: "C-2", fields: { ref: "C-2", title: "Patch", start_date: "2026-10-21T08:00:00.000Z" } }],
    });

    const overview = await new DashboardService(objects).overview("7d");

    assert.ok(oql.includes("SELECT Incident WHERE start_date >= '2026-10-15 00:00:00'"));
    // The week (Sunday to Sunday) holding Wed 21 Oct.
    assert.ok(
      oql.includes("SELECT Change WHERE start_date >= '2026-10-18 00:00:00' AND start_date < '2026-10-25 00:00:00'"),
    );
    assert.equal(overview.trend.at(-1)?.date, "2026-10-21");
    assert.equal(overview.trend.at(-1)?.created, 1);
    assert.equal(overview.trend[0]?.date, "2026-10-15");
    assert.equal(overview.changeCalendar[0]?.scheduledAt, "2026-10-21T08:00:00.000Z");
    assert.equal(overview.recentIncidents[0]?.createdAt, "2026-10-20T22:15:00.000Z");
  });
});
