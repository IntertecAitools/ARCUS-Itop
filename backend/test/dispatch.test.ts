import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { runAs, type Caller } from "../src/core/request-context.js";
import type { ItopResult } from "../src/itop/types.js";
import {
  DispatchService,
  matchRule,
  MemoryAssignmentRuleStore,
  type AssignmentRule,
} from "../src/modules/dispatch/index.js";
import { assignmentRulesSchema } from "../src/modules/dispatch/dispatch.schemas.js";
import type { Mail, Mailer } from "../src/platform/auth/mailer.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import type { CurrentContact } from "../src/shared/current-contact.js";
import { actionsForState, STATUS_MAP } from "../src/shared/ticket-mapping.js";
import { mayApplyStimulus } from "../src/shared/stimulus-rights.js";
import { FakeItopClient, getResponse } from "./helpers.js";

const TZ = "Europe/Paris";
const schema = CmdbSchema.fromFile(fileURLToPath(new URL("../../cmdb-schema/cmdb-schema.json", import.meta.url)));

const staff = (profiles: string[], contactId = 41): Caller =>
  ({ userId: 5, login: "agent", contactId, name: "Agent", kind: "staff", profiles, isAdmin: false, allowedOrgIds: [], orgId: 1, email: "" }) as Caller;
const deskAgent = staff(["Service Desk Agent"]);
const supportAgent = staff(["Support Agent"]);

const rule = (over: Partial<AssignmentRule> = {}): AssignmentRule => ({
  id: "r1",
  name: "Network",
  enabled: true,
  teamId: "7",
  ...over,
});

const ok: ItopResult = { code: 0, message: "", objects: {} };
const missing: ItopResult = { code: 100, message: "Unknown attribute dispatch_date" };

class CaptureMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
}

const contact = (id = "41") => ({ resolve: async () => id }) as unknown as CurrentContact;

function build(fake: FakeItopClient, options: { rules?: AssignmentRule[]; notifyTeam?: boolean; mailer?: Mailer } = {}) {
  const objects = new ObjectsService(fake.asClient(), schema, "test", TZ);
  const store = new MemoryAssignmentRuleStore();
  if (options.rules) void store.save("", { rules: options.rules, notifyTeam: options.notifyTeam ?? false }, "admin");
  const dispatch = new DispatchService(
    fake.asClient(),
    objects,
    store,
    contact(),
    "https://desk.example",
    options.mailer,
  );
  objects.addCreateListener((className, object) => dispatch.route(className, object));
  objects.addTransitionGuard((className, _id, stimulus) => dispatch.guard(className, stimulus));
  objects.addStimulusListener((className, object, stimulus) => dispatch.afterStimulus(className, object, stimulus));
  return { objects, dispatch, store };
}

/** core/get answers by the class and key it is asked for. */
function gets(answer: (params: Record<string, unknown>) => ItopResult | undefined) {
  return (params: Record<string, unknown>) => {
    const key = String(params["key"]);
    if (key.includes("dispatch_date > '2000-01-01'")) return ok;
    return answer(params) ?? getResponse([]);
  };
}

describe("matchRule", () => {
  const facts = { ticketType: "incident" as const, organizationId: "3", serviceId: "10", serviceSubcategoryId: "100" };

  it("takes the first enabled rule whose every set criterion matches", () => {
    const rules = [
      rule({ id: "off", enabled: false }),
      rule({ id: "other-service", serviceId: "11" }),
      rule({ id: "service", serviceId: "10", teamId: "8" }),
      rule({ id: "catch-all", teamId: "9" }),
    ];
    assert.equal(matchRule(rules, facts)?.id, "service");
  });

  it("matches on category, organisation and subcategory too", () => {
    assert.equal(matchRule([rule({ ticketType: "request" })], facts), undefined);
    assert.equal(matchRule([rule({ organizationId: "4" })], facts), undefined);
    assert.equal(matchRule([rule({ serviceSubcategoryId: "101" })], facts), undefined);
    assert.equal(
      matchRule([rule({ ticketType: "incident", organizationId: "3", serviceId: "10", serviceSubcategoryId: "100" })], facts)?.id,
      "r1",
    );
  });

  it("a rule with no criteria is a catch-all; no rules match nothing", () => {
    assert.equal(matchRule([rule()], { ticketType: "request" })?.id, "r1");
    assert.equal(matchRule([], facts), undefined);
  });
});

describe("the Dispatched state (arcus-ticket-dispatch, added at schema load)", () => {
  it("dispatch leaves New (and Escalated TTO; Approved for a request) for Dispatched", () => {
    for (const cls of ["Incident", "UserRequest"]) {
      const lifecycle = schema.require(cls).lifecycle!;
      assert.ok(lifecycle.userActions.includes("ev_dispatch"), cls);
      assert.equal(lifecycle.transitions["new"]!["ev_dispatch"], "dispatched", cls);
      assert.equal(lifecycle.transitions["escalated_tto"]!["ev_dispatch"], "dispatched", cls);
      assert.deepEqual(lifecycle.transitions["dispatched"], {
        ev_assign: "assigned",
        ev_dispatch: "dispatched",
        ev_timeout: "escalated_tto",
        ev_autoresolve: "resolved",
      });
      // The team is asked for and required, the agent is not.
      assert.deepEqual(lifecycle.flags["dispatched"]!["team_id"], ["mandatory", "must_prompt"]);
      assert.equal(lifecycle.flags["dispatched"]!["agent_id"], undefined);
      assert.ok(schema.require(cls).fields["status"]!.values!.includes("dispatched"));
    }
    assert.equal(schema.require("UserRequest").lifecycle!.transitions["approved"]!["ev_dispatch"], "dispatched");
    assert.equal(schema.require("Incident").labels.values["status"]!["dispatched"], "Dispatched");
  });

  it("maps to our own `dispatched` status, with Assign and Dispatch offered", () => {
    assert.equal(STATUS_MAP["dispatched"], "dispatched");
    const lifecycle = schema.require("Incident").lifecycle!;
    assert.deepEqual(actionsForState("new", lifecycle), ["assign", "dispatch"]);
    assert.deepEqual(actionsForState("dispatched", lifecycle), ["assign", "dispatch"]);
  });

  it("Service Desk and Support Agents may dispatch; a portal user may not", () => {
    for (const cls of ["Incident", "UserRequest"]) {
      const lineage = schema.lineage(cls);
      assert.ok(mayApplyStimulus(lineage, "ev_dispatch", deskAgent), cls);
      assert.ok(mayApplyStimulus(lineage, "ev_dispatch", supportAgent), cls);
      assert.ok(!mayApplyStimulus(lineage, "ev_dispatch", staff(["Portal user"])), cls);
      assert.ok(!mayApplyStimulus(lineage, "ev_dispatch", staff(["Configuration ReadOnly"])), cls);
    }
  });
});

describe("assignment rules route a new ticket", () => {
  const created = (cls: string, fields: Record<string, unknown> = {}) =>
    getResponse([{ class: cls, id: 12, fields: { status: "new", ...fields } }]);

  function fakeFor(cls: string, ticket: Record<string, unknown>) {
    return new FakeItopClient()
      .on("core/create", created(cls))
      .on(
        "core/get",
        gets((p) =>
          p["class"] === cls
            ? getResponse([{ class: cls, id: 12, fields: { status: "new", team_id: "0", agent_id: "0", ...ticket } }])
            : undefined,
        ),
      )
      .on("core/apply_stimulus", getResponse([{ class: cls, id: 12, fields: { ref: "R-12", title: "VPN", team_id: "7", team_name: "Network" } }]));
  }

  it("dispatches to the first matching rule's team, as the service account, and hands back the re-read ticket", async () => {
    const fake = fakeFor("UserRequest", { org_id: "3", service_id: "10", servicesubcategory_id: "0" });
    const { objects } = build(fake, { rules: [rule({ serviceId: "11", teamId: "8" }), rule({ id: "r2", serviceId: "10", teamId: "7" })] });

    // A portal user raises it: they hold no dispatch grant, the rule acts.
    await runAs({ ...staff(["Portal user"]), kind: "portal" } as Caller, () =>
      objects.create("UserRequest", { title: "VPN", description: "x", org_id: 3 }, { asService: true }),
    );

    const stimulus = fake.calls.find((c) => c.verb === "core/apply_stimulus")!;
    assert.equal(stimulus.params["stimulus"], "ev_dispatch");
    assert.deepEqual(stimulus.params["fields"], { team_id: 7 });
    assert.equal(stimulus.as, "service");
    assert.match(String(stimulus.params["comment"]), /assignment rule "Network"/);
    // Re-read after routing, so the screen shows it dispatched.
    assert.equal(fake.calls.at(-1)!.verb, "core/get");
  });

  it("leaves New what no rule matches, what already has a team or agent, and everything without the extension", async () => {
    for (const [ticket, rules] of [
      [{ service_id: "99" }, [rule({ serviceId: "10" })]],
      [{ team_id: "5" }, [rule()]],
      [{ agent_id: "2" }, [rule()]],
      [{}, [rule({ enabled: false })]],
    ] as const) {
      const fake = fakeFor("Incident", ticket);
      const { objects } = build(fake, { rules: [...rules] });
      await objects.create("Incident", { title: "t", description: "d", org_id: 1 });
      assert.ok(!fake.calls.some((c) => c.verb === "core/apply_stimulus"), JSON.stringify(ticket));
    }

    const fake = new FakeItopClient()
      .on("core/create", created("Incident"))
      .on("core/get", (p) => (String(p["key"]).includes("dispatch_date") ? missing : getResponse([])));
    const { objects } = build(fake, { rules: [rule()] });
    await objects.create("Incident", { title: "t", description: "d", org_id: 1 });
    assert.ok(!fake.calls.some((c) => c.verb === "core/apply_stimulus"));
  });

  it("a routing failure never fails the create", async () => {
    const fake = fakeFor("Incident", {}).on("core/apply_stimulus", { code: 100, message: "boom" });
    const { objects } = build(fake, { rules: [rule()] });
    const { object } = await objects.create("Incident", { title: "t", description: "d", org_id: 1 });
    assert.equal(object.id, 12);
  });

  it("emails the team when the rules say so: its own address, else each member", async () => {
    const mailer = new CaptureMailer();
    const fake = fakeFor("Incident", {}).on(
      "core/get",
      gets((p) => {
        if (p["class"] === "Incident") return getResponse([{ class: "Incident", id: 12, fields: { status: "new", team_id: "0", agent_id: "0" } }]);
        if (p["class"] === "Team") return getResponse([{ class: "Team", id: 7, fields: { name: "Network", email: "" } }]);
        if (p["class"] === "Person") {
          return getResponse([
            { class: "Person", id: 1, fields: { email: "Ana@example.com" } },
            { class: "Person", id: 2, fields: { email: "ana@example.com" } },
            { class: "Person", id: 3, fields: { email: "bo@example.com" } },
          ]);
        }
        return undefined;
      }),
    );
    const { objects } = build(fake, { rules: [rule()], notifyTeam: true, mailer });
    await objects.create("Incident", { title: "VPN", description: "d", org_id: 1 });

    assert.deepEqual(mailer.sent.map((m) => m.to), ["ana@example.com", "bo@example.com"]);
    assert.match(mailer.sent[0]!.subject, /^\[R-12\] For Network: VPN/);
    assert.match(mailer.sent[0]!.text, /https:\/\/desk\.example\/incidents\/12/);
  });
});

describe("dispatching by hand", () => {
  it("is refused with a 409 on an iTop without the extension", async () => {
    const fake = new FakeItopClient().on("core/get", missing).on("core/apply_stimulus", ok);
    const { objects } = build(fake);
    await assert.rejects(
      runAs(deskAgent, () => objects.applyStimulus("Incident", 12, "ev_dispatch", { team_id: 7 })),
      (e: unknown) => e instanceof AppError && e.code === "conflict" && /arcus-ticket-dispatch/.test(e.message),
    );
    assert.ok(!fake.calls.some((c) => c.verb === "core/apply_stimulus"));
  });

  it("goes through, and emails the team's own address when notifying is on", async () => {
    const mailer = new CaptureMailer();
    const fake = new FakeItopClient()
      .on(
        "core/get",
        gets((p) => {
          if (p["class"] === "UserRequest") {
            return getResponse([{ class: "UserRequest", id: 12, fields: { ref: "R-12", title: "Printer", team_id: "7", team_name: "Network" } }]);
          }
          if (p["class"] === "Team") return getResponse([{ class: "Team", id: 7, fields: { name: "Network", email: "net@example.com" } }]);
          return undefined;
        }),
      )
      .on("core/apply_stimulus", getResponse([{ class: "UserRequest", id: 12, fields: { status: "dispatched" } }]));
    const { objects } = build(fake, { rules: [], notifyTeam: true, mailer });

    await runAs(deskAgent, () => objects.applyStimulus("UserRequest", 12, "ev_dispatch", { team_id: 7 }));
    assert.deepEqual(mailer.sent.map((m) => m.to), ["net@example.com"]);
    assert.match(mailer.sent[0]!.text, /\/records\/UserRequest\/12/);
  });
});

describe("the team's queue and Take it", () => {
  it("lists what waits for the caller's teams, unassigned, oldest dispatch first", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      gets((p) => {
        if (p["class"] === "Team") return getResponse([{ class: "Team", id: 7, fields: { friendlyname: "Network" } }]);
        if (p["class"] === "Incident") {
          return getResponse([
            {
              class: "Incident",
              id: 1,
              fields: { ref: "I-1", title: "Down", status: "dispatched", priority: "2", team_id: "7", team_name: "Network", start_date: "2026-10-28T08:00:00Z", dispatch_date: "2026-10-28T09:00:00Z", sla_tto_passed: "0" },
            },
          ]);
        }
        if (p["class"] === "UserRequest") {
          return getResponse([
            {
              class: "UserRequest",
              id: 2,
              fields: { ref: "R-2", title: "Laptop", status: "escalated_tto", priority: "4", team_id: "7", team_name: "Network", start_date: "2026-10-28T07:00:00Z", dispatch_date: "2026-10-28T07:30:00Z" },
            },
          ]);
        }
        return undefined;
      }),
    );
    const { dispatch } = build(fake);
    const queue = await runAs(supportAgent, () => dispatch.queue());

    assert.deepEqual(queue.teams, [{ id: "7", name: "Network" }]);
    assert.deepEqual(queue.items.map((i) => [i.type, i.ref, i.priority, i.escalated]), [
      ["request", "R-2", "low", true],
      ["incident", "I-1", "high", false],
    ]);
    const oql = String(
      fake.calls.find((c) => c.params["class"] === "Incident" && String(c.params["key"]).includes("team_id"))!.params["key"],
    );
    assert.match(oql, /team_id IN \(7\) AND agent_id = 0 AND status IN \('dispatched','escalated_tto'\)/);
    const teams = String(fake.calls.find((c) => c.params["class"] === "Team")!.params["key"]);
    assert.match(teams, /l\.person_id = 41/);
  });

  it("is empty, without asking for tickets, for someone in no team", async () => {
    const fake = new FakeItopClient().on("core/get", gets(() => undefined));
    const { dispatch } = build(fake);
    const queue = await runAs(supportAgent, () => dispatch.queue());
    assert.deepEqual(queue, { teams: [], items: [], available: true, truncated: false });
  });

  const waiting = (fields: Record<string, unknown> = {}) =>
    getResponse([{ class: "Incident", id: 12, fields: { ref: "I-12", status: "dispatched", team_id: "7", team_name: "Network", agent_id: "0", ...fields } }]);

  it("Take it assigns the ticket to the caller with ev_assign", async () => {
    const fake = new FakeItopClient()
      .on("core/get", gets((p) => (p["class"] === "Incident" ? waiting() : p["class"] === "lnkPersonToTeam" ? getResponse([{ class: "lnkPersonToTeam", id: 1, fields: {} }]) : undefined)))
      .on("core/apply_stimulus", getResponse([{ class: "Incident", id: 12, fields: {} }]));
    const { dispatch } = build(fake);
    const taken = await runAs(deskAgent, () => dispatch.take("incident", "12"));

    assert.deepEqual(taken, { type: "incident", id: "12", ref: "I-12" });
    const stimulus = fake.calls.find((c) => c.verb === "core/apply_stimulus")!;
    assert.equal(stimulus.params["stimulus"], "ev_assign");
    assert.deepEqual(stimulus.params["fields"], { agent_id: 41 });
  });

  it("only a member of the team takes it, only while nobody has, only from a queue", async () => {
    const notMember = new FakeItopClient().on("core/get", gets((p) => (p["class"] === "Incident" ? waiting() : undefined)));
    await assert.rejects(
      runAs(deskAgent, () => build(notMember).dispatch.take("incident", "12")),
      (e: unknown) => e instanceof AppError && e.code === "forbidden" && /member of Network/.test(e.message),
    );

    const taken = new FakeItopClient().on(
      "core/get",
      gets((p) => (p["class"] === "Incident" ? waiting({ agent_id: "3", agent_id_friendlyname: "Bo Li" }) : undefined)),
    );
    await assert.rejects(
      runAs(deskAgent, () => build(taken).dispatch.take("incident", "12")),
      (e: unknown) => e instanceof AppError && e.code === "conflict" && /taken by Bo Li/.test(e.message),
    );

    const assigned = new FakeItopClient().on("core/get", gets((p) => (p["class"] === "Incident" ? waiting({ status: "new", team_id: "0" }) : undefined)));
    await assert.rejects(
      runAs(deskAgent, () => build(assigned).dispatch.take("incident", "12")),
      (e: unknown) => e instanceof AppError && e.code === "bad_request",
    );
  });
});

describe("the rules document", () => {
  it("saves and reads back per tenant, with who changed it", async () => {
    const fake = new FakeItopClient().on("core/get", gets(() => undefined));
    const { dispatch } = build(fake);
    const saved = await runAs({ ...supportAgent, login: "admin" } as Caller, () =>
      dispatch.saveRules({ rules: [rule()], notifyTeam: true }),
    );
    assert.deepEqual(saved.rules, [rule()]);
    assert.equal(saved.notifyTeam, true);
    assert.equal(saved.available, true);
    assert.equal(saved.mailConfigured, false);
    assert.equal(saved.updatedBy, "admin");
    assert.deepEqual(await dispatch.test({ ticketType: "incident" }), { rule: rule() });
  });

  it("refuses two rules with one id; the schema wants a name and a numeric team", async () => {
    const { dispatch } = build(new FakeItopClient());
    await assert.rejects(dispatch.saveRules({ rules: [rule(), rule()], notifyTeam: false }), /share the id/);

    assert.ok(!assignmentRulesSchema.safeParse({ rules: [{ ...rule(), teamId: "" }], notifyTeam: false }).success);
    assert.ok(!assignmentRulesSchema.safeParse({ rules: [{ ...rule(), name: " " }], notifyTeam: false }).success);
    const parsed = assignmentRulesSchema.parse({ rules: [{ ...rule(), serviceId: "", ticketType: "" }], notifyTeam: false });
    assert.equal(parsed.rules[0]!.serviceId, undefined);
    assert.equal(parsed.rules[0]!.ticketType, undefined);
  });
});
