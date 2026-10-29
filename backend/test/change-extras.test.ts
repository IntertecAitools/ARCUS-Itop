import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import { ChangeCalendarService, ChangePirService, ChangeRiskService } from "../src/modules/changes/index.js";
import { blackoutsHit, markClashes, span } from "../src/modules/changes/calendar.js";
import { completeRiskModel, DEFAULT_RISK_MODEL, riskLevel, riskScore } from "../src/modules/changes/risk.js";
import type { CalendarChange } from "../src/modules/changes/changes.types.js";
import { MemoryDocStore } from "../src/shared/doc-store.js";
import { FakeItopClient, getResponse } from "./helpers.js";

const TZ = "Europe/Paris";

const staff: Caller = {
  userId: 5,
  login: "chg.owner",
  contactId: 41,
  name: "Change Owner",
  kind: "staff",
  profiles: ["Change Implementor"],
  isAdmin: false,
  allowedOrgIds: [],
  orgId: 1,
  email: "",
};

const conflictWith = (reason: string) => (e: unknown) =>
  e instanceof AppError && e.code === "conflict" && (e.details as { reason?: string })?.reason === reason;

function item(id: string, start: string, end: string, cis: string[], services: string[] = [], status: CalendarChange["status"] = "planned"): CalendarChange {
  return {
    id,
    ref: `C-${id}`,
    title: `Change ${id}`,
    type: "normal",
    status,
    start,
    end,
    organization: { id: "1", name: "Demo" },
    team: null,
    cis: cis.map((c) => ({ id: c, name: `CI ${c}` })),
    services: services.map((s) => ({ id: s, name: `Service ${s}` })),
    outage: false,
    risk: null,
    clashes: [],
    blackouts: [],
  };
}

describe("calendar clashes", () => {
  it("flags overlapping changes on the same CI, both ways", () => {
    const a = item("1", "2026-11-02T20:00:00.000Z", "2026-11-02T22:00:00.000Z", ["10"]);
    const b = item("2", "2026-11-02T21:00:00.000Z", "2026-11-02T23:00:00.000Z", ["10", "11"]);
    const c = item("3", "2026-11-02T22:00:00.000Z", "2026-11-02T23:00:00.000Z", ["10"]); // starts as a ends
    markClashes([a, b, c]);
    assert.deepEqual(a.clashes, [{ changeId: "2", ref: "C-2", on: [{ kind: "ci", name: "CI 10" }] }]);
    assert.deepEqual(b.clashes.map((x) => x.changeId).sort(), ["1", "3"]);
    assert.deepEqual(c.clashes.map((x) => x.changeId), ["2"]);
  });

  it("flags a shared service, and ignores different CIs and rejected changes", () => {
    const a = item("1", "2026-11-02T20:00:00.000Z", "2026-11-02T22:00:00.000Z", ["10"], ["5"]);
    const b = item("2", "2026-11-02T21:00:00.000Z", "", ["11"], ["5"]);
    const c = item("3", "2026-11-02T20:30:00.000Z", "2026-11-02T21:30:00.000Z", ["10"], [], "rejected");
    const d = item("4", "2026-11-02T20:30:00.000Z", "2026-11-02T21:30:00.000Z", ["99"]);
    markClashes([a, b, c, d]);
    assert.deepEqual(a.clashes, [{ changeId: "2", ref: "C-2", on: [{ kind: "service", name: "Service 5" }] }]);
    assert.equal(c.clashes.length, 0);
    assert.equal(d.clashes.length, 0);
  });

  it("gives a change with no end an hour", () => {
    const [from, to] = span("2026-11-02T20:00:00.000Z", "");
    assert.equal(to - from, 3_600_000);
  });

  it("finds the blackout windows a change runs into", () => {
    const blackout = { id: "b", name: "Year-end freeze", start: "2026-12-20T00:00:00.000Z", end: "2027-01-03T00:00:00.000Z", reason: "", updatedAt: "", updatedBy: "" };
    assert.deepEqual(blackoutsHit(item("1", "2026-12-19T23:30:00.000Z", "2026-12-20T01:00:00.000Z", []), [blackout]), [
      { id: "b", name: "Year-end freeze" },
    ]);
    assert.deepEqual(blackoutsHit(item("2", "2026-12-19T22:00:00.000Z", "2026-12-20T00:00:00.000Z", []), [blackout]), []);
  });
});

describe("ChangeCalendarService", () => {
  const changes = getResponse([
    { class: "NormalChange", id: 1, fields: { ref: "C-1", title: "Patch DB", status: "plannedscheduled", start_date: "2026-11-02 21:00:00", end_date: "2026-11-02 23:00:00", org_id: 3, org_name: "Demo", team_id: 7, team_name: "DBA", outage: "yes" } },
    { class: "RoutineChange", id: 2, fields: { ref: "C-2", title: "Restart DB", status: "assigned", start_date: "2026-11-02 22:00:00", end_date: "", org_id: 3, org_name: "Demo", team_id: 0, team_name: "", outage: "no" } },
  ]);
  const fake = () =>
    new FakeItopClient().on("core/get", (params) => {
      if (params["class"] === "Change") return changes;
      if (params["class"] === "lnkFunctionalCIToTicket") {
        return getResponse([
          { class: "lnkFunctionalCIToTicket", id: 1, fields: { ticket_id: 1, functionalci_id: 10, functionalci_name: "db01" } },
          { class: "lnkFunctionalCIToTicket", id: 2, fields: { ticket_id: 2, functionalci_id: 11, functionalci_name: "db02" } },
        ]);
      }
      return getResponse([
        { class: "lnkFunctionalCIToService", id: 1, fields: { functionalci_id: 10, service_id: 5, service_name: "Payroll" } },
        { class: "lnkFunctionalCIToService", id: 2, fields: { functionalci_id: 11, service_id: 5, service_name: "Payroll" } },
      ]);
    });

  it("reads the window, links CIs and services, flags clashes and blackouts, then filters", async () => {
    const store = new MemoryDocStore();
    const client = fake();
    const calendar = new ChangeCalendarService(client.asClient(), store, TZ, async () => new Map([[1, "high" as const]]));
    await calendar.createBlackout({ name: "Freeze", start: "2026-11-02T21:30:00.000Z", end: "2026-11-03T00:00:00.000Z", reason: "" });

    const all = await calendar.calendar({ from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" });
    const oql = String(client.calls[0]?.params["key"]);
    assert.match(oql, /start_date < '2026-12-01 01:00:00'/);
    assert.match(oql, /end_date >= '2026-11-01 01:00:00'/);
    assert.equal(all.items.length, 2);
    const [one, two] = all.items;
    assert.equal(one?.start, "2026-11-02T20:00:00.000Z");
    assert.equal(one?.risk, "high");
    assert.deepEqual(one?.services, [{ id: "5", name: "Payroll" }]);
    assert.deepEqual(one?.clashes, [{ changeId: "2", ref: "C-2", on: [{ kind: "service", name: "Payroll" }] }]);
    assert.equal(two?.team, null);
    assert.deepEqual(one?.blackouts.map((b) => b.name), ["Freeze"]);
    assert.deepEqual(all.options.teams, [{ id: "7", name: "DBA" }]);
    assert.equal(all.truncated, false);

    const filtered = await calendar.calendar({ from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z", teamId: "7" });
    assert.deepEqual(filtered.items.map((i) => i.id), ["1"]);
    // The clash with the hidden change stays.
    assert.equal(filtered.items[0]?.clashes.length, 1);
  });

  it("refuses a window that is backwards or too wide", async () => {
    const calendar = new ChangeCalendarService(fake().asClient(), new MemoryDocStore(), TZ, async () => new Map());
    await assert.rejects(calendar.calendar({ from: "2026-11-02T00:00:00Z", to: "2026-11-01T00:00:00Z" }), /from before to/);
    await assert.rejects(calendar.calendar({ from: "2026-01-01T00:00:00Z", to: "2026-12-01T00:00:00Z" }), /at most/);
  });

  it("keeps blackout windows: create, update, delete", async () => {
    const calendar = new ChangeCalendarService(fake().asClient(), new MemoryDocStore(), TZ, async () => new Map());
    const created = await runAs(staff, () =>
      calendar.createBlackout({ name: " Freeze ", start: "2026-12-20T00:00:00Z", end: "2027-01-03T00:00:00Z", reason: "Year end" }),
    );
    assert.equal(created.name, "Freeze");
    assert.equal(created.updatedBy, "chg.owner");
    await assert.rejects(
      calendar.updateBlackout(created.id, { name: "x", start: "2026-12-20T00:00:00Z", end: "2026-12-19T00:00:00Z", reason: "" }),
      /end after/,
    );
    await calendar.deleteBlackout(created.id);
    assert.deepEqual(await calendar.blackouts(), []);
    await assert.rejects(calendar.deleteBlackout(created.id), /not found/);
  });
});

describe("risk scoring", () => {
  const questions = DEFAULT_RISK_MODEL.questions.routine;

  it("scores 0–100 by weight, and only when every question is answered", () => {
    assert.equal(riskScore(questions, { impact: "one-team", rollback: "automatic", hours: "outside" }), 0);
    assert.equal(riskScore(questions, { impact: "business", rollback: "none", hours: "peak" }), 100);
    // impact 3×4 + rollback 3×4 + hours 2×5 = 34 of 80
    assert.equal(riskScore(questions, { impact: "one-service", rollback: "documented", hours: "quiet" }), 43);
    assert.equal(riskScore(questions, { impact: "business" }), null);
    assert.equal(riskScore(questions, { impact: "business", rollback: "gone", hours: "peak" }), null);
  });

  it("levels by the thresholds", () => {
    const t = { medium: 35, high: 65 };
    assert.equal(riskLevel(34, t), "low");
    assert.equal(riskLevel(35, t), "medium");
    assert.equal(riskLevel(65, t), "high");
  });

  it("completes a damaged stored model from the defaults", () => {
    const model = completeRiskModel({
      questions: { normal: [{ id: "x", text: "Only one option", weight: 2, options: [{ id: "a", label: "A", score: 1 }] }] },
      thresholds: { medium: 80, high: 50 },
      requiredBeforePlan: { normal: true },
    });
    assert.deepEqual(model.questions.normal, []);
    assert.deepEqual(model.questions.routine, DEFAULT_RISK_MODEL.questions.routine);
    assert.deepEqual(model.thresholds, DEFAULT_RISK_MODEL.thresholds);
    assert.equal(model.requiredBeforePlan.normal, true);
  });
});

describe("ChangeRiskService", () => {
  const changeAs = (cls: string, status = "assigned") =>
    new FakeItopClient().on("core/get", getResponse([{ class: cls, id: 12, fields: { ref: "C-12", title: "Patch", status } }]));

  it("stores the answers, score and level with the change", async () => {
    const risk = new ChangeRiskService(changeAs("RoutineChange").asClient(), new MemoryDocStore());
    const before = await risk.get(12);
    assert.equal(before.score, null);
    assert.equal(before.canEdit, true);
    const after = await runAs(staff, () => risk.answer(12, { impact: "business", rollback: "none", hours: "peak", extra: "ignored" }));
    assert.equal(after.score, 100);
    assert.equal(after.level, "high");
    assert.equal(after.forcesCab, true);
    assert.equal(after.assessedBy, "chg.owner");
    assert.deepEqual(Object.keys(after.answers).sort(), ["hours", "impact", "rollback"]);
    assert.deepEqual((await risk.levels([12, 13])).get(12), "high");
  });

  it("refuses partial answers, and answers on an implemented change", async () => {
    const risk = new ChangeRiskService(changeAs("NormalChange").asClient(), new MemoryDocStore());
    await assert.rejects(risk.answer(12, { impact: "business" }), /Answer every question/);
    const done = new ChangeRiskService(changeAs("NormalChange", "implemented").asClient(), new MemoryDocStore());
    await assert.rejects(done.answer(12, {}), /already implemented/);
  });

  it("keeps a high-risk routine change off the pre-approved path", async () => {
    const risk = new ChangeRiskService(changeAs("RoutineChange").asClient(), new MemoryDocStore());
    await risk.check(12, "routine", "plan"); // nothing answered, nothing required
    await risk.answer(12, { impact: "business", rollback: "none", hours: "peak" });
    await assert.rejects(risk.check(12, "routine", "plan"), conflictWith("risk_needs_cab"));
    await assert.rejects(risk.check(12, "routine", "implement"), conflictWith("risk_needs_cab"));
  });

  it("asks for the questionnaire before planning when the administrator requires it", async () => {
    const store = new MemoryDocStore();
    const risk = new ChangeRiskService(changeAs("NormalChange").asClient(), store);
    const model = structuredClone(DEFAULT_RISK_MODEL);
    model.requiredBeforePlan.normal = true;
    await risk.saveModel(model);
    await assert.rejects(risk.check(12, "normal", "plan"), conflictWith("risk_missing"));
    await risk.check(12, "normal", "implement");
    const answers = Object.fromEntries(model.questions.normal.map((q) => [q.id, q.options[0]!.id]));
    await risk.answer(12, answers);
    await risk.check(12, "normal", "plan");
    // A question added later makes the answers stale: planning asks again.
    model.questions.normal.push({ id: "vendor", text: "Vendor involved?", help: "", weight: 1, options: [{ id: "no", label: "No", score: 0 }, { id: "yes", label: "Yes", score: 10 }] });
    await risk.saveModel(model);
    assert.equal((await risk.get(12)).stale, true);
    await assert.rejects(risk.check(12, "normal", "plan"), conflictWith("risk_missing"));
  });

  it("refuses a model with duplicate ids or crossed thresholds", async () => {
    const risk = new ChangeRiskService(changeAs("NormalChange").asClient(), new MemoryDocStore());
    const dup = structuredClone(DEFAULT_RISK_MODEL);
    dup.questions.normal.push(dup.questions.normal[0]!);
    await assert.rejects(risk.saveModel(dup), /share an id/);
    const crossed = structuredClone(DEFAULT_RISK_MODEL);
    crossed.thresholds = { medium: 70, high: 60 };
    await assert.rejects(risk.saveModel(crossed), /below the high/);
  });
});

describe("ChangePirService", () => {
  const fake = (status: string) =>
    new FakeItopClient().on("core/get", (params) => {
      if (params["class"] === "Incident") {
        return getResponse([{ class: "Incident", id: 30, fields: { ref: "I-30", title: "Mail down" } }]);
      }
      if (String(params["key"]).startsWith("SELECT Change")) {
        return getResponse([
          { class: "NormalChange", id: 12, fields: { ref: "C-12", title: "Patch", status: "implemented", org_name: "Demo", team_name: "Ops", end_date: "2026-10-20 22:00:00", close_date: "" } },
          { class: "NormalChange", id: 13, fields: { ref: "C-13", title: "Upgrade", status: "closed", org_name: "Demo", team_name: "Ops", end_date: "2026-10-10 22:00:00", close_date: "2026-10-12 10:00:00" } },
        ]);
      }
      return getResponse([{ class: "NormalChange", id: 12, fields: { ref: "C-12", title: "Patch", status } }]);
    });

  it("is due once implemented, and leaves the queue once written", async () => {
    const pir = new ChangePirService(fake("implemented").asClient(), new MemoryDocStore(), TZ);
    assert.equal((await pir.get(12)).due, true);
    assert.deepEqual((await pir.queue()).items.map((i) => i.ref), ["C-13", "C-12"]);
    const saved = await runAs(staff, () =>
      pir.save(12, {
        outcome: "partial",
        wentWell: "Done in the window",
        wentBadly: "Mail queued for 20 minutes",
        incidents: ["I-30"],
        followUps: [{ text: "Add a queue alert", owner: "Ops", due: "2026-11-15", done: false }, { text: " ", owner: "", due: "", done: false }],
      }),
    );
    assert.equal(saved.due, false);
    assert.deepEqual(saved.review?.incidents, [{ id: "30", ref: "I-30", title: "Mail down" }]);
    assert.equal(saved.review?.followUps.length, 1);
    assert.equal(saved.review?.completedBy, "chg.owner");
    assert.deepEqual((await pir.queue()).items.map((i) => i.ref), ["C-13"]);
  });

  it("refuses a review before the change is implemented, or a failure without what went badly", async () => {
    const early = new ChangePirService(fake("approved").asClient(), new MemoryDocStore(), TZ);
    assert.equal((await early.get(12)).allowed, false);
    await assert.rejects(
      early.save(12, { outcome: "successful", wentWell: "", wentBadly: "", incidents: [], followUps: [] }),
      conflictWith("not_implemented"),
    );
    const pir = new ChangePirService(fake("closed").asClient(), new MemoryDocStore(), TZ);
    await assert.rejects(
      pir.save(12, { outcome: "rolled_back", wentWell: "", wentBadly: "", incidents: [], followUps: [] }),
      /did not go well/,
    );
  });
});
