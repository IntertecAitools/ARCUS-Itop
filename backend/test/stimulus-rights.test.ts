import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import type { ItopResult } from "../src/itop/types.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import { allowedStimuli, mayApplyStimulus, profilesGranting } from "../src/shared/stimulus-rights.js";
import { FakeItopClient, getResponse } from "./helpers.js";

const TZ = "Europe/Paris";
const schema = CmdbSchema.fromFile(fileURLToPath(new URL("../../cmdb-schema/cmdb-schema.json", import.meta.url)));

const staff = (profiles: string[], isAdmin = false): Caller =>
  ({ userId: 5, login: "agent", contactId: 41, name: "Agent", kind: "staff", profiles, isAdmin, allowedOrgIds: [], orgId: 1, email: "" }) as Caller;
const deskAgent = staff(["Service Desk Agent", "REST Services User"]);
const supportAgent = staff(["Support Agent"]);
const problemManager = staff(["Problem Manager"]);
const readOnly = staff(["Configuration ReadOnly"]);
const portal = { ...staff(["Portal user"]), kind: "portal" } as Caller;

const forbidden = (stimulus: string, needs?: RegExp) => (e: unknown) =>
  e instanceof AppError &&
  e.code === "forbidden" &&
  e.status === 403 &&
  (e.details as { reason?: string; stimulus?: string })?.reason === "profile_not_allowed" &&
  (e.details as { stimulus?: string }).stimulus === stimulus &&
  (!needs || needs.test(e.message));

const ok: ItopResult = { code: 0, message: "", objects: {} };
const stimulated = (cls: string): ItopResult => ({
  code: 0,
  message: "",
  objects: { [`${cls}::7`]: { code: 0, message: "", class: cls, key: "7", fields: { status: "assigned" } } },
});

const objectsWith = (fake: FakeItopClient) => new ObjectsService(fake.asClient(), schema, "test", TZ);

describe("stimulus grants (itop-profiles-itil)", () => {
  const incident = schema.lineage("Incident");
  const request = schema.lineage("UserRequest");
  const problem = schema.lineage("Problem");

  it("a Service Desk Agent only assigns and dispatches incidents and requests", () => {
    // ev_dispatch: the arcus-ticket-dispatch extension (schema/load.ts adds it).
    assert.deepEqual(allowedStimuli(incident, schema.require("Incident").lifecycle!.userActions, deskAgent), ["ev_assign", "ev_dispatch"]);
    assert.deepEqual(allowedStimuli(request, schema.require("UserRequest").lifecycle!.userActions, deskAgent), ["ev_assign", "ev_dispatch"]);
    assert.deepEqual(allowedStimuli(problem, schema.require("Problem").lifecycle!.userActions, deskAgent), []);
  });

  it("a Support Agent works incidents and requests but approves nothing", () => {
    assert.deepEqual(
      allowedStimuli(incident, schema.require("Incident").lifecycle!.userActions, supportAgent).sort(),
      ["ev_assign", "ev_close", "ev_dispatch", "ev_pending", "ev_reassign", "ev_resolve"],
    );
    assert.ok(mayApplyStimulus(request, "ev_wait_for_approval", supportAgent));
    assert.ok(!mayApplyStimulus(request, "ev_approve", supportAgent));
    assert.ok(!mayApplyStimulus(incident, "ev_reopen", supportAgent));
  });

  it("problems are the Problem Manager's", () => {
    for (const s of ["ev_assign", "ev_reassign", "ev_resolve", "ev_close"]) {
      assert.ok(mayApplyStimulus(problem, s, problemManager), s);
      assert.ok(!mayApplyStimulus(problem, s, supportAgent), s);
    }
    assert.ok(!mayApplyStimulus(incident, "ev_assign", problemManager));
  });

  it("read-only profiles apply nothing; administrators and sign-in-less development everything", () => {
    for (const cls of ["Incident", "UserRequest", "Problem", "NormalChange"]) {
      for (const s of schema.require(cls).lifecycle!.userActions) {
        assert.ok(!mayApplyStimulus(schema.lineage(cls), s, readOnly), `${cls} ${s}`);
        assert.ok(mayApplyStimulus(schema.lineage(cls), s, staff([], true)), `${cls} ${s}`);
      }
    }
    assert.ok(mayApplyStimulus(incident, "ev_resolve", undefined));
  });

  it("portal users close and reopen their own tickets, nothing more", () => {
    assert.deepEqual(allowedStimuli(request, schema.require("UserRequest").lifecycle!.userActions, portal).sort(), ["ev_close", "ev_reopen"]);
    assert.deepEqual(allowedStimuli(incident, schema.require("Incident").lifecycle!.userActions, portal).sort(), ["ev_close", "ev_reopen"]);
  });

  it("a group includes its subclasses: the Change group's grants reach every change type", () => {
    // Change Implementor's ev_assign comes from the Change group only.
    for (const cls of ["NormalChange", "EmergencyChange", "RoutineChange"]) {
      assert.ok(mayApplyStimulus(schema.lineage(cls), "ev_assign", staff(["Change Implementor"])), cls);
    }
    // ev_validate is the Supervisor's on normal changes alone.
    assert.ok(mayApplyStimulus(schema.lineage("NormalChange"), "ev_validate", staff(["Change Supervisor"])));
    assert.ok(!mayApplyStimulus(schema.lineage("RoutineChange"), "ev_validate", staff(["Change Supervisor"])));
    assert.ok(!mayApplyStimulus(schema.lineage("NormalChange"), "ev_validate", staff(["Change Implementor"])));
  });

  it("names the profiles that grant an action, leaving SuperUser out when others do", () => {
    assert.deepEqual(profilesGranting(incident, "ev_assign"), ["Service Desk Agent", "Support Agent"]);
    assert.deepEqual(profilesGranting(problem, "ev_resolve"), ["Problem Manager"]);
    assert.deepEqual(profilesGranting(incident, "ev_dispatch"), ["Service Desk Agent", "Support Agent"]);
    assert.deepEqual(profilesGranting(incident, "ev_reopen"), ["Portal user"]);
  });
});

describe("ObjectsService.applyStimulus refuses what the caller's profiles do not grant", () => {
  it("403 before iTop is asked, with the profile it needs", async () => {
    const fake = new FakeItopClient().on("core/apply_stimulus", stimulated("Incident"));
    await assert.rejects(
      runAs(deskAgent, () => objectsWith(fake).applyStimulus("Incident", 7, "ev_resolve", { solution: "x" })),
      forbidden("ev_resolve", /incident \(it needs Support Agent\)/),
    );
    await assert.rejects(
      runAs(readOnly, () => objectsWith(fake).applyStimulus("UserRequest", 7, "ev_assign", { agent_id: 3 })),
      forbidden("ev_assign", /user request \(it needs Service Desk Agent or Support Agent\)/),
    );
    await assert.rejects(
      runAs(supportAgent, () => objectsWith(fake).applyStimulus("Problem", 7, "ev_resolve", {})),
      forbidden("ev_resolve", /needs Problem Manager/),
    );
    assert.equal(fake.calls.length, 0);
  });

  it("applies what the profiles grant", async () => {
    const fake = new FakeItopClient().on("core/apply_stimulus", stimulated("Incident"));
    await runAs(deskAgent, () => objectsWith(fake).applyStimulus("Incident", 7, "ev_assign", { agent_id: 3 }));
    await runAs(supportAgent, () => objectsWith(fake).applyStimulus("Incident", 7, "ev_resolve", { solution: "Rebooted" }));
    assert.equal(fake.calls.filter((c) => c.verb === "core/apply_stimulus").length, 2);
  });

  it("refuses per record in a bulk action", async () => {
    const fake = new FakeItopClient().on("core/apply_stimulus", stimulated("Incident"));
    const result = await runAs(deskAgent, () =>
      objectsWith(fake).bulk("Incident", [7, 8], { action: "stimulus", stimulus: "ev_close" }),
    );
    assert.equal(fake.calls.length, 0);
    assert.ok(JSON.stringify(result).includes("profile"), JSON.stringify(result));
  });

  it("checks a change by its own type when it is addressed through a parent class", async () => {
    const fake = new FakeItopClient()
      .on("core/get", getResponse([{ class: "RoutineChange", id: 12, fields: {} }]))
      .on("core/apply_stimulus", ok);
    // ev_validate is a Supervisor's on a NORMAL change; this one is routine.
    await assert.rejects(
      runAs(staff(["Change Supervisor"]), () => objectsWith(fake).applyStimulus("Change", 12, "ev_validate", {})),
      forbidden("ev_validate"),
    );
    assert.equal(fake.calls[0]?.verb, "core/get");
    assert.equal(fake.calls.some((c) => c.verb === "core/apply_stimulus"), false);
  });

  it("keeps the change grants PR #30 introduced", async () => {
    const fake = new FakeItopClient().on("core/apply_stimulus", ok);
    await assert.rejects(
      runAs(staff(["Change Implementor"]), () => objectsWith(fake).applyStimulus("NormalChange", 12, "ev_validate", {})),
      forbidden("ev_validate", /normal change \(it needs Change Supervisor\)/),
    );
    await assert.rejects(
      runAs(staff(["Change Approver"]), () => objectsWith(fake).applyStimulus("NormalChange", 12, "ev_assign", {})),
      forbidden("ev_assign", /needs Change Implementor or Change Supervisor/),
    );
    await assert.rejects(
      runAs(staff(["Change Supervisor"]), () => objectsWith(fake).applyStimulus("RoutineChange", 12, "ev_implement", {})),
      forbidden("ev_implement", /needs Change Implementor/),
    );
  });

  it("allowedActions lists only the granted user actions, for the records screens", () => {
    const objects = objectsWith(new FakeItopClient());
    assert.deepEqual(runAs(deskAgent, () => objects.allowedActions("Incident")), ["ev_assign", "ev_dispatch"]);
    assert.deepEqual(runAs(readOnly, () => objects.allowedActions("Problem")), []);
    assert.deepEqual(runAs(problemManager, () => objects.allowedActions("Problem")).sort(), ["ev_assign", "ev_close", "ev_reassign", "ev_resolve"]);
    // A parent class offers what any of its types grants.
    assert.ok(runAs(staff(["Change Supervisor"]), () => objects.allowedActions("Change")).includes("ev_validate"));
  });
});
