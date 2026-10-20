import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ItopClient } from "../src/itop/client.js";
import {
  bodyFromItop,
  bodyToItop,
  buildRecipients,
  NotificationsService,
  parseRecipients,
  subjectFromItop,
  subjectToItop,
  type RuleInput,
} from "../src/platform/admin/notifications.service.js";
import { fileURLToPath } from "node:url";

import { CmdbSchema } from "../src/schema/load.js";

/** The real generated schema: these rules need UserRequest and its lifecycle. */
const schema = CmdbSchema.fromFile(fileURLToPath(new URL("../../cmdb-schema/cmdb-schema.json", import.meta.url)));
const sampleSchema = () => schema;

const BASE = "https://help.example.test";

describe("recipients", () => {
  it("turns roles and people into one Person query, and reads it back", () => {
    const oql = buildRecipients(
      [{ kind: "caller" }, { kind: "team" }, { kind: "people", ids: [3, 5] }],
      [],
    );
    assert.equal(
      oql,
      "SELECT Person WHERE id = :this->caller_id OR id IN (SELECT Person AS p JOIN lnkPersonToTeam AS l " +
        "ON l.person_id = p.id WHERE l.team_id = :this->team_id) OR id IN (3, 5)",
    );
    assert.deepEqual(parseRecipients(oql), { roles: ["caller", "team"], personIds: [3, 5], custom: [] });
  });

  it("keeps parts it does not recognise, and puts them back when asked", () => {
    const parsed = parseRecipients("SELECT Person WHERE id = :this->agent_id OR org_id = 4");
    assert.deepEqual(parsed, { roles: ["agent"], personIds: [], custom: ["org_id = 4"] });
    assert.equal(
      buildRecipients([{ kind: "caller" }, { kind: "custom", index: 0 }], parsed.custom),
      "SELECT Person WHERE id = :this->caller_id OR (org_id = 4)",
    );
  });

  it("keeps a query of another shape whole, and refuses to mix it with roles", () => {
    const oql = "SELECT Team WHERE id = :this->team_id";
    const parsed = parseRecipients(oql);
    assert.deepEqual(parsed.custom, [oql]);
    assert.equal(buildRecipients([{ kind: "custom", index: 0 }], parsed.custom), oql);
    assert.throws(
      () => buildRecipients([{ kind: "custom", index: 0 }, { kind: "caller" }], parsed.custom),
      /cannot be combined/,
    );
  });

  it("does not split on an OR inside a sub-query or a quoted value", () => {
    const parsed = parseRecipients(
      "SELECT Person WHERE id IN (SELECT Person WHERE name = 'a OR b' OR id = 2) OR id = :this->agent_id",
    );
    assert.deepEqual(parsed.roles, ["agent"]);
    assert.equal(parsed.custom.length, 1);
  });

  it("reads iTop's own mention recipient", () => {
    assert.deepEqual(parseRecipients("SELECT Person WHERE id = :mentioned->id").roles, ["mentioned"]);
  });
});

describe("texts", () => {
  it("writes fields as iTop placeholders and HTML paragraphs, escaping what was typed", () => {
    const html = bodyToItop("Hello {{caller}},\n\nTicket {{ref}} <b>is</b> done.\nBye", "UserRequest", BASE);
    assert.equal(
      html,
      "<p>Hello $this->caller_id_friendlyname$,</p>\n<p>Ticket $this->ref$ &lt;b&gt;is&lt;/b&gt; done.<br>Bye</p>",
    );
  });

  it("links to the record in our app, never to iTop", () => {
    const html = bodyToItop("{{link}}", "Incident", BASE);
    assert.match(html, /href="https:\/\/help\.example\.test\/records\/Incident\/\$this->id\$"/);
    assert.throws(() => bodyToItop("{{link}}", "Incident", undefined), /APP_BASE_URL/);
  });

  it("reads back our link as iTop stores it (URL-encoded) and iTop's own link", () => {
    const stored =
      '<p><a href="https://help.example.test/records/Incident/%24this-&gt;id%24">Open it in the helpdesk</a></p>';
    assert.equal(bodyFromItop(stored), "{{link}}");
    assert.equal(bodyFromItop("<p>See $this-&gt;hyperlink()$</p>"), "See {{link}}");
  });

  it("round-trips a body", () => {
    const text = 'Hello {{caller}},\n\nYour request {{ref}} "{{title}}" is resolved.\nThanks\n\n{{link}}';
    assert.equal(bodyFromItop(bodyToItop(text, "UserRequest", BASE)), text);
  });

  it("round-trips a subject and refuses unknown fields", () => {
    assert.equal(subjectToItop("{{ref}} resolved", "UserRequest", BASE), "$this->ref$ resolved");
    assert.equal(subjectFromItop("$this->ref$ resolved"), "{{ref}} resolved");
    assert.throws(() => subjectToItop("{{nope}}", "UserRequest", BASE), /Unknown field/);
  });
});

/** Records the writes and answers reads from simple in-memory tables. */
function fakeItop() {
  let nextId = 100;
  const objects = new Map<string, { class: string; id: number; fields: Record<string, unknown> }>();
  const writes: string[] = [];
  const put = (cls: string, fields: Record<string, unknown>) => {
    const id = nextId++;
    objects.set(`${cls}::${id}`, { class: cls, id, fields: { ...fields } });
    return id;
  };
  const response = (rows: Array<{ class: string; id: number; fields: Record<string, unknown> }>) => ({
    code: 0,
    message: `Found: ${rows.length}`,
    objects: Object.fromEntries(
      rows.map((r) => [`${r.class}::${r.id}`, { code: 0, message: "", class: r.class, key: String(r.id), fields: r.fields }]),
    ),
  });
  const client = {
    async call(verb: string, params: Record<string, unknown>) {
      const cls = String(params["class"]);
      if (verb === "core/create") {
        writes.push(`create ${cls}`);
        return response([{ class: cls, id: put(cls, params["fields"] as Record<string, unknown>), fields: {} }]);
      }
      if (verb === "core/update") {
        writes.push(`update ${cls} ${String(params["key"])}`);
        const row = [...objects.values()].find((o) => o.id === Number(params["key"]));
        Object.assign(row!.fields, params["fields"]);
        return response([]);
      }
      if (verb === "core/delete") {
        writes.push(`delete ${cls} ${String(params["key"])}`);
        for (const [k, o] of objects) if (o.id === Number(params["key"])) objects.delete(k);
        return response([]);
      }
      const all = [...objects.values()];
      if (cls === "Trigger") return response(all.filter((o) => o.class.startsWith("Trigger")));
      if (cls === "Person") return response([]);
      return response(all.filter((o) => o.class === cls));
    },
  };
  return { client: client as unknown as ItopClient, writes, objects, put };
}

const sender = { address: "helpdesk@example.test", label: "Helpdesk" };

const rule: RuleInput = {
  name: "Request resolved",
  event: { kind: "state_entered", recordType: "UserRequest", state: "resolved" },
  email: {
    to: [{ kind: "caller" }],
    cc: [],
    subject: "{{ref}} resolved",
    body: "Done.\n\n{{link}}",
    status: "on",
  },
};

describe("NotificationsService", () => {
  it("creates the email, the trigger and the link between them, sent from the helpdesk address", async () => {
    const itop = fakeItop();
    const service = new NotificationsService(itop.client, sampleSchema(), BASE, sender);
    const created = await service.create(rule);
    assert.deepEqual(itop.writes, ["create ActionEmail", "create TriggerOnStateEnter", "create lnkTriggerAction"]);
    const email = [...itop.objects.values()].find((o) => o.class === "ActionEmail")!;
    assert.equal(email.fields["from"], "helpdesk@example.test");
    assert.equal(email.fields["to"], "SELECT Person WHERE id = :this->caller_id");
    assert.equal(created.event.kind, "state_entered");
    assert.equal(created.email.body, "Done.\n\n{{link}}");
  });

  it("deletes a rule's trigger and email only when no other rule uses them", async () => {
    const itop = fakeItop();
    const service = new NotificationsService(itop.client, sampleSchema(), BASE, sender);
    const emailId = itop.put("ActionEmail", { name: "Shared", status: "enabled", to: "", cc: "", subject: "", body: "" });
    const t1 = itop.put("TriggerOnObjectCreate", { target_class: "UserRequest" });
    const t2 = itop.put("TriggerOnObjectCreate", { target_class: "Incident" });
    const l1 = itop.put("lnkTriggerAction", { trigger_id: t1, action_id: emailId });
    itop.put("lnkTriggerAction", { trigger_id: t2, action_id: emailId });

    await service.remove(l1);
    assert.deepEqual(itop.writes, [`delete lnkTriggerAction ${l1}`, `delete TriggerOnObjectCreate ${t1}`]);
  });

  it("adds the in-app part on the same trigger, and removes it with the rule", async () => {
    const itop = fakeItop();
    const service = new NotificationsService(itop.client, sampleSchema(), BASE, sender);
    const created = await service.create({ ...rule, inApp: { on: true, message: "{{ref}} resolved" } });
    assert.deepEqual(itop.writes, [
      "create ActionEmail",
      "create TriggerOnStateEnter",
      "create lnkTriggerAction",
      "create ActionNewsroom",
      "create lnkTriggerAction",
    ]);
    const inApp = [...itop.objects.values()].find((o) => o.class === "ActionNewsroom")!;
    assert.equal(inApp.fields["recipients"], "SELECT Person WHERE id = :this->caller_id");
    assert.equal(inApp.fields["message"], "$this->ref$ resolved");
    assert.deepEqual(created.inApp, { on: true, message: "{{ref}} resolved" });

    itop.writes.length = 0;
    await service.remove(created.id);
    assert.ok(itop.writes.includes(`delete ActionNewsroom ${inApp.id}`), itop.writes.join(" | "));
    assert.equal([...itop.objects.values()].filter((o) => o.class !== "lnkTriggerAction").length, 0);
  });

  it("refuses rules it cannot send correctly", async () => {
    const itop = fakeItop();
    const service = new NotificationsService(itop.client, sampleSchema(), BASE, undefined);
    await assert.rejects(() => service.create({ ...rule, name: " " }), /name/);
    await assert.rejects(() => service.create({ ...rule, email: { ...rule.email, to: [] } }), /receives/);
    await assert.rejects(
      () => service.create({ ...rule, event: { ...rule.event, recordType: "NoSuchThing" } }),
      /Unknown kind of record/,
    );
    await assert.rejects(
      () => service.create({ ...rule, email: { ...rule.email, status: "test" } }),
      /test address/,
    );
  });
});
