import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import type { ItopResult } from "../src/itop/types.js";
import { ChangesService, MemoryPlanRuleStore } from "../src/modules/changes/index.js";
import {
  completeRules,
  DEFAULT_PLAN_RULES,
  listPlans,
  missingPlans,
  requiredAt,
} from "../src/modules/changes/plan-rules.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse } from "./helpers.js";

const TZ = "Europe/Paris";

/** A change as core/get on Change returns it. `extension: false` is an iTop without arcus-change-cab. */
function change(
  cls: "NormalChange" | "EmergencyChange" | "RoutineChange",
  fields: Record<string, unknown> = {},
  extension = true,
) {
  return {
    class: cls,
    id: 12,
    fields: {
      ref: "C-000012",
      title: "Patch the mail relay",
      status: "assigned",
      org_name: "Demo",
      start_date: "2026-11-02 20:00:00",
      end_date: "2026-11-02 22:00:00",
      outage: "yes",
      impact: "Mail down 10 minutes",
      fallback: "",
      ...(extension ? { implementation_plan: "", test_plan: "" } : {}),
      ...fields,
    },
  };
}

const ok: ItopResult = { code: 0, message: "", objects: {} };
const created = (id: number): ItopResult => ({
  code: 0,
  message: "",
  objects: { [`ChangeCabDecision::${id}`]: { code: 0, message: "", class: "ChangeCabDecision", key: String(id), fields: {} } },
});

/**
 * A fake iTop answering core/get by class: the change for Change, the given
 * decisions for ChangeCabDecision.
 */
function itop(row: ReturnType<typeof change>, decisions: Array<{ id: number; fields: Record<string, unknown> }> = []) {
  return new FakeItopClient()
    .on("core/get", (params) =>
      params["class"] === "ChangeCabDecision"
        ? getResponse(decisions.map((d) => ({ class: "ChangeCabDecision", ...d })))
        : getResponse([row]),
    )
    .on("core/update", ok)
    .on("core/create", created(77))
    .on("core/apply_stimulus", ok)
    .on("core/delete", ok);
}

const service = (fake: FakeItopClient, store = new MemoryPlanRuleStore()) =>
  new ChangesService(fake.asClient(), store, TZ);

const staff = (profiles: string[], isAdmin = false): Caller =>
  ({ userId: 5, login: "cab.chair", contactId: 41, name: "Cab Chair", kind: "staff", profiles, isAdmin, allowedOrgIds: [], orgId: 1, email: "" }) as Caller;
const approver = staff(["Change Approver", "REST Services User"]);
const implementor = staff(["Change Implementor", "REST Services User"]);

const conflictWith = (reason: string) => (e: unknown) =>
  e instanceof AppError && e.code === "conflict" && (e.details as { reason?: string })?.reason === reason;

/* ------------------------------------------------------------------------- */

describe("plan rules", () => {
  it("defaults: every plan before a normal or emergency change is planned, only implementation for routine", () => {
    assert.deepEqual(requiredAt(DEFAULT_PLAN_RULES.normal, "plan"), ["implementation", "rollback", "test"]);
    assert.deepEqual(requiredAt(DEFAULT_PLAN_RULES.emergency, "plan"), ["implementation", "rollback", "test"]);
    assert.deepEqual(requiredAt(DEFAULT_PLAN_RULES.routine, "plan"), ["implementation"]);
    assert.deepEqual(requiredAt(DEFAULT_PLAN_RULES.routine, "implement"), ["implementation"]);
  });

  it("a plan required at plan is required at implement too; 'implement' only there", () => {
    const rule = { implementation: "plan", rollback: "implement", test: "optional" } as const;
    assert.deepEqual(requiredAt(rule, "plan"), ["implementation"]);
    assert.deepEqual(requiredAt(rule, "implement"), ["implementation", "rollback"]);
    assert.deepEqual(missingPlans(rule, { implementation: "  ", rollback: "x", test: "" }, "implement"), ["implementation"]);
  });

  it("completes stored rules from the defaults and drops unknown values", () => {
    const rules = completeRules({ routine: { test: "implement", rollback: "sometimes" }, bogus: {} });
    assert.equal(rules.routine.test, "implement");
    assert.equal(rules.routine.rollback, "optional");
    assert.deepEqual(rules.normal, DEFAULT_PLAN_RULES.normal);
    assert.deepEqual(completeRules("garbage"), DEFAULT_PLAN_RULES);
  });

  it("names plans in a sentence", () => {
    assert.equal(listPlans(["test"]), "test plan");
    assert.equal(listPlans(["implementation", "rollback", "test"]), "implementation plan, rollback plan and test plan");
  });
});

describe("ChangesService governance", () => {
  it("reads the plans, this type's rule, what is missing and the CAB history (newest first)", async () => {
    const fake = itop(change("NormalChange", { status: "plannedscheduled", implementation_plan: "Steps", fallback: "Undo" }), [
      { id: 3, fields: { change_id: 12, meeting_date: "2026-10-20 10:00:00", decision: "deferred", attendees: "Ann\nBo\n", conditions: "", notes: "More data", recorded_by_name: "Cab Chair", recorded_at: "2026-10-20 11:00:00" } },
      { id: 4, fields: { change_id: 12, meeting_date: "2026-10-27 10:00:00", decision: "deferred", attendees: "", conditions: "", notes: "", recorded_by_name: "", recorded_at: "" } },
    ]);
    const g = await runAs(approver, () => service(fake).governance(12));
    assert.equal(g.type, "normal");
    assert.equal(g.status, "planned");
    assert.equal(g.available, true);
    assert.deepEqual(g.plans, { implementation: "Steps", rollback: "Undo", test: "" });
    assert.deepEqual(g.missing, { plan: ["test"], implement: ["test"] });
    assert.equal(g.cab.required, true);
    assert.equal(g.cab.awaiting, true);
    assert.equal(g.cab.canDecide, true);
    assert.deepEqual(g.cab.decisions.map((d) => d.id), ["4", "3"]);
    assert.deepEqual(g.cab.decisions[1]!.attendees, ["Ann", "Bo"]);
    assert.equal(g.cab.decisions[1]!.meetingDate, "2026-10-20T08:00:00.000Z");
    const get = fake.calls.find((c) => c.params["class"] === "Change")!;
    assert.match(String(get.params["output_fields"]), /implementation_plan/);
  });

  it("an implementor sees the CAB but cannot decide; routine changes never go to the CAB", async () => {
    const g = await runAs(implementor, () => service(itop(change("NormalChange", { status: "plannedscheduled" }))).governance(12));
    assert.equal(g.cab.canDecide, false);
    const r = await runAs(approver, () => service(itop(change("RoutineChange", { status: "plannedscheduled" }))).governance(12));
    assert.equal(r.cab.required, false);
    assert.equal(r.cab.awaiting, false);
    assert.deepEqual(r.missing.plan, ["implementation"]);
  });

  it("without the extension: unavailable, no CAB read, only the rollback plan can be missing", async () => {
    const fake = itop(change("NormalChange", {}, false));
    const g = await service(fake).governance(12);
    assert.equal(g.available, false);
    assert.deepEqual(g.missing.plan, ["rollback"]);
    assert.equal(fake.calls.some((c) => c.params["class"] === "ChangeCabDecision"), false);
  });

  it("saves only the changed plans, the rollback plan as iTop's fallback", async () => {
    const fake = itop(change("RoutineChange", { implementation_plan: "Same" }));
    await service(fake).savePlans(12, { implementation: "Same ", rollback: " Restore snapshot ", test: "" });
    const update = fake.calls.find((c) => c.verb === "core/update")!;
    assert.equal(update.params["class"], "Change");
    assert.deepEqual(update.params["fields"], { fallback: "Restore snapshot" });
  });

  it("refuses an implementation or test plan on an iTop without the extension", async () => {
    const fake = itop(change("NormalChange", {}, false));
    await assert.rejects(service(fake).savePlans(12, { test: "Smoke test" }), conflictWith("extension_missing"));
    assert.equal(fake.calls.some((c) => c.verb === "core/update"), false);
    await service(fake).savePlans(12, { rollback: "Undo" });
    assert.ok(fake.calls.some((c) => c.verb === "core/update"));
  });
});

describe("ChangesService.guardTransition", () => {
  it("ignores other classes and other actions without asking iTop", async () => {
    const fake = new FakeItopClient();
    await service(fake).guardTransition("Incident", 1, "ev_plan", {});
    await service(fake).guardTransition("NormalChange", 1, "ev_assign", {});
    assert.equal(fake.calls.length, 0);
  });

  it("blocks Plan on a normal change until every plan is written, naming them", async () => {
    await assert.rejects(
      service(itop(change("NormalChange"))).guardTransition("NormalChange", 12, "ev_plan", {}),
      (e: unknown) =>
        conflictWith("plans_missing")(e) &&
        /Add the implementation plan, rollback plan and test plan before planning this normal change/.test((e as Error).message),
    );
  });

  it("counts a rollback plan given with the action itself", async () => {
    const svc = service(itop(change("EmergencyChange", { implementation_plan: "a", test_plan: "b" })));
    await assert.rejects(svc.guardTransition("EmergencyChange", 12, "ev_plan", {}), /rollback plan/);
    await svc.guardTransition("EmergencyChange", 12, "ev_plan", { fallback: "Revert" });
  });

  it("lets a routine change be planned with its implementation plan only (default rules)", async () => {
    await service(itop(change("RoutineChange", { implementation_plan: "Steps" }))).guardTransition("RoutineChange", 12, "ev_plan", {});
    await assert.rejects(service(itop(change("RoutineChange"))).guardTransition("Change", 12, "ev_plan", {}), /implementation plan/);
  });

  it("applies an administrator's rules: a test plan needed only to implement", async () => {
    const store = new MemoryPlanRuleStore();
    await store.save("", completeRules({ routine: { test: "implement" } }), "admin");
    const fake = itop(change("RoutineChange", { status: "plannedscheduled", implementation_plan: "Steps" }));
    await service(fake, store).guardTransition("RoutineChange", 12, "ev_plan", {});
    await assert.rejects(
      service(fake, store).guardTransition("RoutineChange", 12, "ev_implement", {}),
      /Add the test plan before implementing this routine change/,
    );
  });

  it("sends Approve / Not approve on normal and emergency changes to the CAB decision", async () => {
    for (const stimulus of ["ev_approve", "ev_notapprove"]) {
      await assert.rejects(
        service(itop(change("NormalChange", { status: "plannedscheduled" }))).guardTransition("NormalChange", 12, stimulus, {}),
        conflictWith("cab_decision_required"),
      );
    }
    await service(itop(change("RoutineChange", { status: "plannedscheduled" }))).guardTransition("RoutineChange", 12, "ev_approve", {});
  });

  it("checks only the rollback plan on an iTop without the extension", async () => {
    const svc = service(itop(change("NormalChange", { fallback: "Undo" }, false)));
    await svc.guardTransition("NormalChange", 12, "ev_plan", {});
  });
});

describe("ChangesService.decide", () => {
  const planned = (cls: "NormalChange" | "EmergencyChange" | "RoutineChange" = "NormalChange", status = "plannedscheduled") =>
    change(cls, { status, implementation_plan: "a", fallback: "b", test_plan: "c" });
  const input = (decision: "approved" | "rejected" | "deferred", extra: Record<string, unknown> = {}) => ({
    meetingDate: "2026-10-27T09:30:00.000Z",
    attendees: [" Ann ", "", "Bo"],
    decision,
    conditions: "",
    notes: "",
    ...extra,
  });

  it("records an approval, then applies Approve with iTop's approval date and comment, as the caller", async () => {
    const fake = itop(planned());
    await runAs(approver, () =>
      service(fake).decide(12, input("approved", { conditions: "Only after 20:00" })),
    );
    const create = fake.calls.find((c) => c.verb === "core/create")!;
    assert.equal(create.params["class"], "ChangeCabDecision");
    const fields = create.params["fields"] as Record<string, unknown>;
    assert.equal(fields["change_id"], 12);
    assert.equal(fields["meeting_date"], "2026-10-27 10:30:00");
    assert.equal(fields["attendees"], "Ann\nBo");
    assert.equal(fields["decision"], "approved");
    assert.equal(fields["recorded_by_id"], 41);
    const stim = fake.calls.find((c) => c.verb === "core/apply_stimulus")!;
    assert.equal(stim.params["class"], "NormalChange");
    assert.equal(stim.params["stimulus"], "ev_approve");
    assert.deepEqual(stim.params["fields"], {
      approval_date: "2026-10-27 10:30:00",
      approval_comment: "CAB 2026-10-27: approved. Conditions: Only after 20:00",
    });
    assert.ok(fake.calls.indexOf(create) < fake.calls.indexOf(stim));
  });

  it("a rejection needs notes and applies Not approve with them as iTop's reason", async () => {
    const fake = itop(planned("EmergencyChange"));
    await assert.rejects(runAs(approver, () => service(fake).decide(12, input("rejected"))), (e: AppError) => e.code === "bad_request");
    await runAs(approver, () => service(fake).decide(12, input("rejected", { notes: "Clashes with the freeze", meetingDate: "2026-10-27" })));
    const stim = fake.calls.find((c) => c.verb === "core/apply_stimulus")!;
    assert.equal(stim.params["stimulus"], "ev_notapprove");
    assert.deepEqual(stim.params["fields"], { reason: "CAB 2026-10-27: not approved. Clashes with the freeze" });
  });

  it("a deferral is recorded and leaves the change waiting", async () => {
    const fake = itop(planned());
    await runAs(approver, () => service(fake).decide(12, input("deferred", { notes: "Next week" })));
    assert.ok(fake.calls.some((c) => c.verb === "core/create"));
    assert.equal(fake.calls.some((c) => c.verb === "core/apply_stimulus"), false);
  });

  it("only a Change Approver or an administrator may decide", async () => {
    const fake = itop(planned());
    await assert.rejects(runAs(implementor, () => service(fake).decide(12, input("approved"))), (e: AppError) => e.code === "forbidden");
    assert.equal(fake.calls.length, 0);
    await runAs(staff([], true), () => service(fake).decide(12, input("deferred")));
  });

  it("refuses routine changes, changes not waiting, and an iTop without the extension", async () => {
    await assert.rejects(runAs(approver, () => service(itop(planned("RoutineChange"))).decide(12, input("approved"))), (e: AppError) => e.code === "bad_request");
    await assert.rejects(runAs(approver, () => service(itop(planned("NormalChange", "assigned"))).decide(12, input("approved"))), /Only a planned change/);
    await assert.rejects(runAs(approver, () => service(itop(change("NormalChange", { status: "plannedscheduled" }, false))).decide(12, input("approved"))), conflictWith("extension_missing"));
  });

  it("takes the decision back out when iTop refuses the transition", async () => {
    const fake = itop(planned()).on("core/apply_stimulus", { code: 1, message: "Not allowed" });
    await assert.rejects(runAs(approver, () => service(fake).decide(12, input("approved"))));
    const del = fake.calls.find((c) => c.verb === "core/delete")!;
    assert.equal(del.params["class"], "ChangeCabDecision");
    assert.equal(del.params["key"], 77);
    assert.equal(del.as, "service");
  });
});

describe("ChangesService.queue", () => {
  it("lists planned normal and emergency changes, soonest first, with the last decision and missing plans", async () => {
    const rows = [
      { ...change("NormalChange", { status: "plannedscheduled", start_date: "2026-11-09 08:00:00" }), id: 20 },
      { ...change("EmergencyChange", { status: "plannedscheduled", implementation_plan: "a", fallback: "b", test_plan: "c" }), id: 21 },
    ];
    const fake = new FakeItopClient().on("core/get", (params) =>
      params["class"] === "ChangeCabDecision"
        ? getResponse([{ class: "ChangeCabDecision", id: 5, fields: { change_id: 20, meeting_date: "2026-10-20 10:00:00", decision: "deferred" } }])
        : getResponse(rows),
    );
    const queue = await service(fake).queue();
    assert.equal(queue.available, true);
    assert.deepEqual(queue.items.map((i) => i.id), ["21", "20"]);
    assert.equal(queue.items[0]!.type, "emergency");
    assert.deepEqual(queue.items[0]!.missingPlans, []);
    assert.equal(queue.items[0]!.outage, true);
    assert.equal(queue.items[1]!.lastDecision?.decision, "deferred");
    assert.deepEqual(queue.items[1]!.missingPlans, ["implementation", "rollback", "test"]);
    const oql = String(fake.calls[0]!.params["key"]);
    assert.match(oql, /finalclass IN \('NormalChange','EmergencyChange'\) AND status = 'plannedscheduled'/);
  });
});

describe("ChangesService rules", () => {
  it("starts from the defaults and saves per tenant with who changed them", async () => {
    const svc = service(new FakeItopClient());
    const before = await svc.getRules();
    assert.deepEqual(before.rules, DEFAULT_PLAN_RULES);
    assert.equal(before.updatedBy, "");
    const rules = structuredClone(DEFAULT_PLAN_RULES);
    rules.normal.test = "implement";
    const after = await runAs(approver, () => svc.saveRules(rules));
    assert.equal(after.rules.normal.test, "implement");
    assert.equal(after.updatedBy, "cab.chair");
    const other = await runAs(approver, () => svc.getRules(), { id: "t2", name: "T2", orgIds: [9] });
    assert.deepEqual(other.rules, DEFAULT_PLAN_RULES);
  });
});

describe("ObjectsService transition guards, on the real schema", () => {
  const schema = CmdbSchema.fromFile(fileURLToPath(new URL("../../cmdb-schema/cmdb-schema.json", import.meta.url)));

  it("asks every guard before applying an action, and a refusal stops it", async () => {
    const fake = new FakeItopClient().on("core/apply_stimulus", ok);
    const objects = new ObjectsService(fake.asClient(), schema, "test", TZ);
    const seen: unknown[] = [];
    objects.addTransitionGuard(async (...args) => {
      seen.push(args);
      if (args[2] === "ev_plan") throw new AppError("conflict", "no plans");
    });
    await assert.rejects(objects.applyStimulus("NormalChange", 12, "ev_plan", { fallback: "x" }), /no plans/);
    assert.deepEqual(seen[0], ["NormalChange", 12, "ev_plan", { fallback: "x" }]);
    assert.equal(fake.calls.length, 0);
  });

  it("no longer marks the rollback plan mandatory: the plan rules decide", () => {
    for (const cls of ["RoutineChange", "NormalChange", "EmergencyChange"]) {
      const flags = schema.require(cls).lifecycle!.flags;
      assert.deepEqual(flags["plannedscheduled"]!["fallback"], ["must_prompt"], cls);
      assert.ok(!flags["approved"]!["fallback"]?.includes("mandatory"), cls);
    }
    // Other mandatory flags are untouched.
    assert.ok(schema.require("NormalChange").lifecycle!.flags["plannedscheduled"]!["impact"]!.includes("mandatory"));
  });
});
