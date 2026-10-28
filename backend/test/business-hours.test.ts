import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { AppError } from "../src/core/errors.js";
import { BusinessHoursService } from "../src/modules/business-hours/index.js";
import { intervalProblems, minutesOf, workingSeconds } from "../src/modules/business-hours/working-time.js";
import type { OpenInterval } from "../src/modules/business-hours/index.js";
import { SlaService } from "../src/modules/sla/index.js";
import { metricState } from "../src/modules/sla/sla-state.js";
import type { ItopResult } from "../src/itop/types.js";
import type { ObjectsService } from "../src/platform/objects/objects.service.js";
import { FakeItopClient, sampleDashboards, sampleNavigation, sampleSchema, testConfig } from "./helpers.js";

const TZ = "Europe/Paris";
/** 09:00–17:00, Monday to Friday. */
const OFFICE: OpenInterval[] = ["monday", "tuesday", "wednesday", "thursday", "friday"].map((weekday) => ({
  weekday: weekday as OpenInterval["weekday"],
  start: "09:00",
  end: "17:00",
}));
/** Paris wall time on a day, as epoch ms (CET, UTC+1, after 25 October 2026). */
const paris = (day: string, time: string) => Date.parse(`${day}T${time}:00+01:00`);
const HOUR = 3600;

/* ------------------------------------------------------------------------- *
 * Working time
 * ------------------------------------------------------------------------- */

describe("working time", () => {
  it("reads HH:MM, 24:00 included", () => {
    assert.equal(minutesOf("09:30"), 570);
    assert.equal(minutesOf("24:00"), 1440);
    assert.ok(Number.isNaN(minutesOf("9h30")));
  });

  it("counts only open hours within a day", () => {
    // Wednesday 28 October 2026, 08:00 → 12:00: open from 09:00, so 3 h.
    assert.equal(workingSeconds(paris("2026-10-28", "08:00"), paris("2026-10-28", "12:00"), OFFICE, new Set(), TZ), 3 * HOUR);
  });

  it("skips nights and the weekend", () => {
    // Friday 16:00 → Monday 10:00: 1 h on Friday, 1 h on Monday.
    assert.equal(workingSeconds(paris("2026-10-30", "16:00"), paris("2026-11-02", "10:00"), OFFICE, new Set(), TZ), 2 * HOUR);
  });

  it("skips holidays", () => {
    const holidays = new Set(["2026-11-11"]);
    // Tuesday 10 November 17:00 → Thursday 12 November 10:00: Wednesday 11 is a holiday.
    assert.equal(
      workingSeconds(paris("2026-11-10", "17:00"), paris("2026-11-12", "10:00"), OFFICE, holidays, TZ),
      1 * HOUR,
    );
  });

  it("is negative when the end comes first", () => {
    assert.equal(workingSeconds(paris("2026-10-28", "12:00"), paris("2026-10-28", "10:00"), OFFICE, new Set(), TZ), -2 * HOUR);
  });

  it("handles open hours to midnight and across a daylight-saving change", () => {
    const allDay: OpenInterval[] = [{ weekday: "sunday", start: "00:00", end: "24:00" }];
    // Sunday 25 October 2026 has 25 hours in Paris (clocks go back at 03:00).
    const from = Date.parse("2026-10-24T22:00:00Z"); // Sunday 00:00 CEST
    const to = Date.parse("2026-10-25T23:00:00Z"); // Monday 00:00 CET
    assert.equal(workingSeconds(from, to, allDay, new Set(), TZ), 25 * HOUR);
  });

  it("refuses intervals that end before they start or overlap", () => {
    assert.deepEqual(intervalProblems(OFFICE), []);
    assert.equal(intervalProblems([{ weekday: "monday", start: "12:00", end: "09:00" }]).length, 1);
    assert.match(
      intervalProblems([
        { weekday: "monday", start: "09:00", end: "12:00" },
        { weekday: "monday", start: "11:00", end: "13:00" },
      ])[0]!,
      /overlaps/,
    );
    assert.deepEqual(
      intervalProblems([
        { weekday: "monday", start: "09:00", end: "12:00" },
        { weekday: "monday", start: "12:00", end: "24:00" },
      ]),
      [],
    );
  });
});

describe("SLA percentages in working time", () => {
  const span = (from: number, to: number) => workingSeconds(from, to, OFFICE, new Set(), TZ);

  it("counts what is left of the target in open hours only", () => {
    // 4 working hours target, Friday 16:00, deadline Monday 12:00: 1 + 3 = 4 h left → 0% used,
    // where wall clock would see 68 h left.
    const m = metricState({
      metric: "ttr",
      className: "Incident",
      status: "assigned",
      startMs: paris("2026-10-30", "16:00"),
      deadlineMs: paris("2026-11-02", "12:00"),
      passed: false,
      timeSpent: 0,
      goal: 4 * HOUR,
      nowMs: paris("2026-10-30", "16:00"),
      span,
    });
    assert.equal(m.state, "within");
    assert.equal(m.percentUsed, 0);
  });

  it("is at risk on Monday morning with one working hour left of four", () => {
    const m = metricState({
      metric: "ttr",
      className: "Incident",
      status: "assigned",
      startMs: paris("2026-10-30", "16:00"),
      deadlineMs: paris("2026-11-02", "12:00"),
      passed: false,
      timeSpent: 0,
      goal: 4 * HOUR,
      nowMs: paris("2026-11-02", "11:00"),
      span,
    });
    assert.equal(m.state, "at_risk");
    assert.equal(m.percentUsed, 75);
  });

  it("is not breached before the deadline even with no open time left", () => {
    // Saturday, deadline at Monday's opening: nothing left to count, but not late yet.
    const m = metricState({
      metric: "tto",
      className: "Incident",
      status: "new",
      startMs: paris("2026-10-30", "16:00"),
      deadlineMs: paris("2026-11-02", "09:00"),
      passed: false,
      timeSpent: 0,
      goal: HOUR,
      nowMs: paris("2026-10-31", "10:00"),
      span,
    });
    assert.equal(m.state, "at_risk");
    assert.equal(m.percentUsed, 99);
  });
});

/* ------------------------------------------------------------------------- *
 * The service, over a fake iTop
 * ------------------------------------------------------------------------- */

const ok = (objects: Record<string, { fields: Record<string, unknown> }> = {}): ItopResult => ({
  code: 0,
  message: "",
  objects: Object.fromEntries(
    Object.entries(objects).map(([key, o]) => {
      const [cls, id] = key.split("::");
      return [key, { code: 0, message: "", class: cls, key: id, fields: o.fields }];
    }),
  ),
}) as unknown as ItopResult;

/** core/get answers per class, read from the OQL. */
function itop(tables: Record<string, Record<string, Record<string, unknown>>>, missing = false) {
  return new FakeItopClient()
    .on("core/get", (params) => {
      const cls = String(params["class"]);
      if (missing && cls !== "CustomerContract" && cls !== "lnkCustomerContractToService") {
        return { code: 100, message: `Error: class '${cls}' is not valid` } as ItopResult;
      }
      if (missing && /coveragewindow_id/.test(String(params["key"]))) {
        return {
          code: 100,
          message: "Error: Query failed to execute: ... Unknown filter code - found 'coveragewindow_id' at 42",
        } as ItopResult;
      }
      const rows = tables[cls] ?? {};
      const oql = String(params["key"]);
      const where = /WHERE (\w+) (=|!=) (\d+)/.exec(oql);
      const kept = Object.entries(rows).filter(([id, f]) => {
        if (!where) return true;
        const value = where[1] === "id" ? id : String(f[where[1]!] ?? "");
        return where[2] === "=" ? value === where[3] : value !== where[3];
      });
      return ok(Object.fromEntries(kept.map(([id, fields]) => [`${cls}::${id}`, { fields }])));
    })
    .on("core/create", (params) =>
      missing
        ? ({ code: 100, message: `Unknown class '${String(params["class"])}'` } as ItopResult)
        : ok({ [`${String(params["class"])}::77`]: { fields: {} } }),
    )
    .on("core/update", () => ok())
    .on("core/delete", () => ok());
}

const TABLES = {
  CoverageWindow: { "1": { name: "Office hours", description: "Mon–Fri" } },
  CoverageWindowInterval: {
    "11": { coverage_window_id: "1", weekday: "tuesday", start_time: "09:00", end_time: "17:00" },
    "10": { coverage_window_id: "1", weekday: "monday", start_time: "09:00", end_time: "17:00" },
  },
  HolidayCalendar: { "3": { name: "France" } },
  Holiday: {
    "5": { name: "Armistice", date: "2026-11-11", calendar_id: "3", calendar_name: "France" },
    "6": { name: "Christmas", date: "2026-12-25", calendar_id: "0", calendar_name: "" },
  },
  lnkCustomerContractToService: {
    "20": {
      customercontract_id: "8",
      customercontract_name: "Support",
      service_id: "7",
      service_name: "Email",
      sla_id: "4",
      sla_name: "Gold",
      coveragewindow_id: "1",
      coveragewindow_name: "Office hours",
    },
    "21": {
      customercontract_id: "8",
      customercontract_name: "Support",
      service_id: "9",
      service_name: "VPN",
      sla_id: "0",
      sla_name: "",
      coveragewindow_id: "0",
      coveragewindow_name: "",
    },
  },
  CustomerContract: { "8": { name: "Support", organization_name: "Acme", org_id: "3" } },
};

describe("BusinessHoursService", () => {
  it("lists windows with their hours, calendars, holidays and contract services", async () => {
    const fake = itop(TABLES);
    const result = await new BusinessHoursService(fake.asClient()).overview();
    assert.equal(result.available, true);
    assert.deepEqual(result.coverageWindows, [
      {
        id: "1",
        name: "Office hours",
        description: "Mon–Fri",
        intervals: [
          { weekday: "monday", start: "09:00", end: "17:00" },
          { weekday: "tuesday", start: "09:00", end: "17:00" },
        ],
        usedBy: 1,
      },
    ]);
    assert.deepEqual(result.calendars, [{ id: "3", name: "France", holidayCount: 1 }]);
    assert.deepEqual(result.holidays.map((h) => [h.name, h.date, h.calendarId]), [
      ["Armistice", "2026-11-11", "3"],
      ["Christmas", "2026-12-25", ""],
    ]);
    assert.deepEqual(
      result.assignments.map((a) => [a.customerName, a.serviceName, a.slaName, a.coverageWindowId]),
      [
        ["Acme", "Email", "Gold", "1"],
        ["Acme", "VPN", "", ""],
      ],
    );
  });

  it("answers unavailable on an iTop without the modules, and refuses writes with 409", async () => {
    const fake = itop({}, true);
    const service = new BusinessHoursService(fake.asClient());
    assert.equal((await service.overview()).available, false);
    await assert.rejects(
      () => service.createHoliday({ name: "x", date: "2026-12-25", calendarId: "" }),
      (e: unknown) => e instanceof AppError && e.status === 409,
    );
    assert.equal(await service.workingCalendar(), null);
  });

  it("creates a window with its open hours as one in-place link set", async () => {
    const fake = itop(TABLES);
    const created = await new BusinessHoursService(fake.asClient()).createWindow({
      name: " Support desk ",
      description: "",
      intervals: [
        { weekday: "tuesday", start: "08:00", end: "18:00" },
        { weekday: "monday", start: "08:00", end: "18:00" },
      ],
    });
    assert.equal(created.id, "77");
    const call = fake.calls.find((c) => c.verb === "core/create")!;
    assert.equal(call.params["class"], "CoverageWindow");
    assert.deepEqual(call.params["fields"], {
      name: "Support desk",
      description: "",
      interval_list: [
        { weekday: "monday", start_time: "08:00", end_time: "18:00" },
        { weekday: "tuesday", start_time: "08:00", end_time: "18:00" },
      ],
    });
    assert.ok(call.params["comment"]);
  });

  it("refuses overlapping hours before asking iTop", async () => {
    const fake = itop(TABLES);
    await assert.rejects(
      () =>
        new BusinessHoursService(fake.asClient()).updateWindow("1", {
          name: "x",
          description: "",
          intervals: [
            { weekday: "monday", start: "09:00", end: "13:00" },
            { weekday: "monday", start: "12:00", end: "17:00" },
          ],
        }),
      (e: unknown) => e instanceof AppError && e.status === 400,
    );
    assert.equal(fake.calls.length, 0);
  });

  it("detaches contract services before deleting a window, so iTop does not delete them", async () => {
    const fake = itop(TABLES);
    const result = await new BusinessHoursService(fake.asClient()).deleteWindow("1");
    assert.equal(result.detached, 1);
    const writes = fake.calls.filter((c) => c.verb !== "core/get");
    assert.deepEqual(
      writes.map((c) => [c.verb, c.params["class"], c.params["key"]]),
      [
        ["core/update", "lnkCustomerContractToService", 20],
        ["core/delete", "CoverageWindow", 1],
      ],
    );
    assert.deepEqual(writes[0]!.params["fields"], { coveragewindow_id: 0 });
  });

  it("sets and clears a contract service's window, and 404s unknown ids", async () => {
    const fake = itop(TABLES);
    const service = new BusinessHoursService(fake.asClient());
    await service.assign("21", { coverageWindowId: "1" });
    await service.assign("20", { coverageWindowId: "" });
    const updates = fake.calls.filter((c) => c.verb === "core/update");
    assert.deepEqual(updates.map((c) => [c.params["key"], c.params["fields"]]), [
      [21, { coveragewindow_id: 1 }],
      [20, { coveragewindow_id: 0 }],
    ]);
    await assert.rejects(() => service.assign("99", { coverageWindowId: "" }), (e: unknown) => e instanceof AppError && e.status === 404);
    await assert.rejects(() => service.assign("21", { coverageWindowId: "42" }), (e: unknown) => e instanceof AppError && e.status === 404);
  });

  it("writes a holiday's calendar as 0 when it has none", async () => {
    const fake = itop(TABLES);
    await new BusinessHoursService(fake.asClient()).createHoliday({ name: "Boxing day", date: "2026-12-26", calendarId: "" });
    const call = fake.calls.find((c) => c.verb === "core/create")!;
    assert.deepEqual(call.params["fields"], { name: "Boxing day", date: "2026-12-26", calendar_id: 0 });
  });

  it("gives the SLA dashboard each ticket's window and every holiday, read as the service account", async () => {
    const fake = itop(TABLES);
    const calendar = (await new BusinessHoursService(fake.asClient()).workingCalendar())!;
    assert.equal(calendar.windowFor("3", "7")?.length, 2);
    assert.equal(calendar.windowFor("3", "9"), null);
    assert.deepEqual([...calendar.holidays].sort(), ["2026-11-11", "2026-12-25"]);
    assert.ok(fake.calls.every((c) => c.as === "service"));
  });
});

describe("SLA dashboard with business hours", () => {
  it("judges a ticket covered by a window in its open hours", async () => {
    // A 10-hour TTR opened Monday 09:00 in a Monday/Tuesday 09:00–17:00
    // window: iTop puts the deadline at Tuesday 11:00. Monday 17:30, after
    // closing, 8 of the 10 working hours are used.
    const now = new Date(paris("2026-11-02", "17:30"));
    const objects = {
      listAll: async (className: string) => {
        const rows: Record<string, Array<{ id: number; fields: Record<string, unknown> }>> = {
          CustomerContract: [{ id: 8, fields: { org_id: "3" } }],
          lnkCustomerContractToService: [{ id: 20, fields: { customercontract_id: "8", service_id: "7", sla_id: "4" } }],
          lnkSLAToSLT: [
            {
              id: 1,
              fields: { sla_id: "4", slt_metric: "ttr", slt_request_type: "incident", slt_ticket_priority: "2", slt_value: "10", slt_value_unit: "hours" },
            },
          ],
          Incident: [
            {
              id: 1,
              fields: {
                ref: "I-1",
                status: "assigned",
                priority: "2",
                org_id: "3",
                service_id: "7",
                team_id: "0",
                start_date: "2026-11-02 09:00:00",
                ttr_escalation_deadline: "2026-11-03 11:00:00",
                sla_tto_passed: "no",
                sla_ttr_passed: "no",
              },
            },
          ],
        };
        const items = (rows[className] ?? []).map((r) => ({ class: className, label: "", ...r }));
        return { items, total: items.length, truncated: false };
      },
    } as unknown as ObjectsService;
    const calendar = new BusinessHoursService(itop(TABLES).asClient());
    const sla = new SlaService(objects, TZ, calendar, () => now);
    const ticket = (await sla.tickets({ type: "incident" })).items[0]!;
    assert.equal(ticket.ttr.state, "at_risk");
    assert.equal(ticket.ttr.percentUsed, 80);

    // On the wall clock 17.5 of 10 hours would be left: within, wrongly.
    const wall = new SlaService(objects, TZ, undefined, () => now);
    assert.equal((await wall.tickets({ type: "incident" })).items[0]!.ttr.state, "within");
  });
});

/* ------------------------------------------------------------------------- *
 * Routes: validation happens before iTop is asked
 * ------------------------------------------------------------------------- */

function app(fake: FakeItopClient) {
  const schema = sampleSchema();
  const built = buildApp(testConfig(), {
    client: fake.asClient(),
    schema,
    navigation: sampleNavigation(schema),
    dashboards: sampleDashboards(fake.asClient(), schema),
  });
  after(async () => {
    await built.app.close();
  });
  return built.app;
}

describe("business-hours routes", () => {
  it("rejects bad input with 400 and no iTop call", async () => {
    const fake = new FakeItopClient();
    const server = app(fake);
    const base = "/api/admin/business-hours";
    const cases = [
      { method: "POST" as const, url: `${base}/coverage-windows`, payload: { name: "x", intervals: [] } },
      {
        method: "POST" as const,
        url: `${base}/coverage-windows`,
        payload: { name: "x", intervals: [{ weekday: "funday", start: "09:00", end: "17:00" }] },
      },
      {
        method: "PUT" as const,
        url: `${base}/coverage-windows/1`,
        payload: { name: "x", intervals: [{ weekday: "monday", start: "9am", end: "17:00" }] },
      },
      { method: "POST" as const, url: `${base}/coverage-windows`, payload: { name: "", intervals: [{ weekday: "monday", start: "09:00", end: "17:00" }] } },
      { method: "POST" as const, url: `${base}/holidays`, payload: { name: "x", date: "2026-02-30" } },
      { method: "POST" as const, url: `${base}/holidays`, payload: { name: "x", date: "25/12/2026" } },
      { method: "POST" as const, url: `${base}/holidays`, payload: { name: "x", date: "2026-12-25", calendarId: "a" } },
      { method: "PUT" as const, url: `${base}/assignments/1`, payload: { coverageWindowId: "x" } },
      { method: "DELETE" as const, url: `${base}/holidays/abc` },
      { method: "POST" as const, url: `${base}/calendars`, payload: { name: "   " } },
    ];
    for (const c of cases) {
      const response = await server.inject(c);
      assert.equal(response.statusCode, 400, `${c.method} ${c.url} ${JSON.stringify(c.payload ?? "")}`);
    }
    assert.equal(fake.calls.length, 0);
  });
});
