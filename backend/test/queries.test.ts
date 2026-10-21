import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { currentCaller, runAs, type Caller } from "../src/core/request-context.js";
import type { ItopClient } from "../src/itop/client.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import {
  bindCallerParameters,
  parseColumns,
  QueriesService,
  queryParameters,
} from "../src/platform/queries/queries.service.js";
import type { TransferService } from "../src/platform/transfer/transfer.service.js";
import { sampleSchema } from "./helpers.js";

type Fields = Record<string, unknown>;
type Call = { verb: string; params: Record<string, unknown>; as: string };

const schema = sampleSchema();

function caller(overrides: Partial<Caller> = {}): Caller {
  return {
    userId: 7,
    login: "alice",
    contactId: 42,
    name: "Alice",
    email: "alice@example.test",
    kind: "staff",
    profiles: ["Service Desk Agent"],
    isAdmin: false,
    allowedOrgIds: [],
    orgId: 1,
    credentials: { user: "alice", password: "pw" },
    ...overrides,
  };
}
const admin = () =>
  caller({ userId: 1, login: "admin", contactId: 1, isAdmin: true, credentials: { user: "admin", password: "pw" } });

/**
 * A small iTop: QueryOQL rows live in a table; any other core/get returns two
 * servers, unless its OQL holds "BROKEN", which iTop refuses as it refuses a
 * query it cannot parse. Every call records whose account it ran under.
 */
function fakeItop(seed: Record<number, Fields>) {
  const queries = new Map(Object.entries(seed).map(([id, f]) => [Number(id), { ...f }]));
  let nextId = 100;
  const calls: Call[] = [];
  const answer = (verb: string, params: Record<string, unknown>) => {
    const cls = String(params["class"]);
    const key = params["key"];
    if (cls === "QueryOQL") {
      if (verb === "core/get") {
        const rows = typeof key === "number" ? [...queries].filter(([id]) => id === key) : [...queries];
        return {
          code: 0,
          message: `Found: ${rows.length}`,
          objects: Object.fromEntries(
            rows.map(([id, fields]) => [`QueryOQL::${id}`, { code: 0, message: "", class: "QueryOQL", key: String(id), fields }]),
          ),
        };
      }
      const fields = (params["fields"] ?? {}) as Fields;
      if (verb === "core/create") {
        const id = nextId++;
        queries.set(id, { is_template: "no", owner_id: 0, ...fields });
        return { code: 0, message: "", objects: { [`QueryOQL::${id}`]: { code: 0, message: "", class: "QueryOQL", key: String(id), fields: {} } } };
      }
      if (verb === "core/update") queries.set(Number(key), { ...queries.get(Number(key)), ...fields });
      if (verb === "core/delete") queries.delete(Number(key));
      return { code: 0, message: "", objects: {} };
    }
    if (String(key).includes("BROKEN")) {
      return { code: 100, message: "Error: Unknown class 'BROKEN', expecting a value in {Server, Organization}" };
    }
    const rows = cls === "Organization" ? [{ id: 3, name: "Demo" }] : [{ id: 1, name: "web-1" }, { id: 2, name: "web-2" }];
    return {
      code: 0,
      message: `Found: ${rows.length}`,
      objects: Object.fromEntries(
        rows.map((r) => [
          `${cls}::${r.id}`,
          { code: 0, message: "", class: cls, key: String(r.id), fields: { friendlyname: r.name, name: r.name } },
        ]),
      ),
    };
  };
  const client = {
    async callRaw(verb: string, params: Record<string, unknown>, options: { asService?: boolean } = {}) {
      calls.push({ verb, params, as: options.asService ? "service" : (currentCaller()?.credentials?.user ?? "service") });
      return answer(verb, params);
    },
    async call(verb: string, params: Record<string, unknown>, options: { asService?: boolean } = {}) {
      const result = (await client.callRaw(verb, params, options)) as { code: number; message: string };
      if (result.code !== 0) throw new AppError("upstream_error", result.message.replace(/^Error: /, ""), { itopCode: result.code });
      return result;
    },
  };
  const exports: Array<{ cls: string; oql: string; format: string; fields?: string }> = [];
  const transfer = {
    async export(cls: string, oql: string, format: string, fields?: string) {
      exports.push({ cls, oql, format, ...(fields ? { fields } : {}) });
      return { body: new Blob([""]).stream(), contentType: "text/csv", filename: "x.csv" };
    },
  };
  const itop = client as unknown as ItopClient;
  const service = new QueriesService(itop, schema, new ObjectsService(itop, schema, "test"), transfer as unknown as TransferService);
  return { service, calls, queries, exports };
}

const SEED: Record<number, Fields> = {
  1: {
    name: "Production servers",
    description: "",
    oql: "SELECT Server WHERE status IN ('production')",
    fields: "name,status",
    is_template: "no",
    owner_id: 42,
    owner_id_friendlyname: "Alice",
  },
  2: {
    name: "Servers of active organisations",
    description: "",
    oql: "SELECT s FROM Server AS s JOIN Organization AS o ON s.org_id = o.id WHERE o.status = 'active'",
    fields: "s.name,s.org_id",
    is_template: "no",
    owner_id: 1,
  },
  3: {
    name: "Agent of the Ticket",
    description: "Used in notifications",
    oql: "SELECT Person WHERE id=:this->agent_id",
    fields: "id,email",
    is_template: "yes",
    owner_id: 0,
  },
  4: {
    name: "Bob's servers",
    description: "",
    oql: "SELECT Server WHERE nb_u > 2",
    fields: "",
    is_template: "no",
    owner_id: 99,
  },
};

describe("query helpers", () => {
  it("finds the parameters a query needs, outside quoted text", () => {
    assert.deepEqual(queryParameters("SELECT Person WHERE id = :this->agent_id AND name != ':not_me'"), ["this->agent_id"]);
    assert.deepEqual(queryParameters("SELECT Server WHERE agent_id = :current_contact_id"), []);
  });

  it("binds the caller's own ids as numbers", () => {
    assert.equal(
      bindCallerParameters("SELECT Ticket WHERE agent_id = :current_contact_id AND name = ':current_user_id'", { contactId: 42, userId: 7 }),
      "SELECT Ticket WHERE agent_id = 42 AND name = ':current_user_id'",
    );
  });

  it("reads iTop's fields as column codes of the class, aliases and unknown codes dropped", () => {
    assert.deepEqual(parseColumns(schema.get("Server"), "s.name, s.org_id,id,email,name"), ["name", "org_id"]);
  });
});

describe("saved queries", () => {
  it("lists the phrasebook with the service account, and shows OQL to administrators only", async () => {
    const { service, calls } = fakeItop(SEED);
    const asStaff = await runAs(caller(), () => service.list());
    assert.ok(calls.every((c) => c.as === "service"));
    assert.ok(asStaff.every((q) => q.oql === undefined));
    const prod = asStaff.find((q) => q.id === 1)!;
    assert.equal(prod.mode, "conditions");
    assert.equal(prod.recordType, "Server");
    assert.deepEqual(prod.conditions, [{ field: "status", op: "in", values: ["production"] }]);
    assert.deepEqual(prod.columns, ["name", "status"]);
    assert.equal(prod.canEdit, true, "Alice owns it");

    const join = asStaff.find((q) => q.id === 2)!;
    assert.equal(join.mode, "oql");
    assert.equal(join.runnable, true);
    assert.equal(join.canEdit, false);
    const template = asStaff.find((q) => q.id === 3)!;
    assert.equal(template.template, true);
    assert.equal(template.runnable, false);
    assert.deepEqual(template.parameters, ["this->agent_id"]);
    assert.equal(asStaff.find((q) => q.id === 4)!.canEdit, false, "someone else's");

    const asAdmin = await runAs(admin(), () => service.list());
    assert.equal(asAdmin.find((q) => q.id === 2)!.oql, SEED[2]!["oql"]);
    assert.ok(asAdmin.every((q) => q.canEdit));
  });

  it("runs a saved query as the caller, in the records list shape", async () => {
    const { service, calls } = fakeItop(SEED);
    const result = await runAs(caller(), () => service.run(1, { page: 1, limit: 25 }));
    assert.equal(result.recordType, "Server");
    assert.deepEqual(result.columns, ["name", "status"]);
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map((i) => i.id), [1, 2]);
    const run = calls.find((c) => c.params["class"] === "Server")!;
    assert.equal(run.as, "alice", "never the service account");
    assert.equal(run.params["key"], "SELECT Server WHERE status IN ('production')");
  });

  it("runs a query that only exists as OQL for staff too", async () => {
    const { service, calls } = fakeItop(SEED);
    await runAs(caller(), () => service.run(2, { page: 1, limit: 25 }));
    assert.equal(calls.find((c) => c.params["class"] === "Server")!.as, "alice");
  });

  it("refuses to run a query that needs values from where iTop uses it", async () => {
    const { service } = fakeItop(SEED);
    await assert.rejects(runAs(caller(), () => service.run(3, { page: 1, limit: 25 })), /this->agent_id/);
  });

  it("exports as the caller through iTop's exporter", async () => {
    const { service, exports } = fakeItop(SEED);
    await runAs(caller(), () => service.export(1, "csv", "name"));
    assert.deepEqual(exports, [{ cls: "Server", oql: "SELECT Server WHERE status IN ('production')", format: "csv", fields: "name" }]);
  });

  it("saves a staff member's condition query through the service account, owned by them", async () => {
    const { service, calls, queries } = fakeItop(SEED);
    const saved = await runAs(caller(), () =>
      service.create({
        name: "Big servers",
        recordType: "Server",
        conditions: [{ field: "nb_u", op: "gt", value: "4" }],
        columns: ["name", "nb_u"],
      }),
    );
    const write = calls.find((c) => c.verb === "core/create")!;
    assert.equal(write.as, "service");
    assert.match(String(write.params["comment"]), /by alice/);
    const stored = queries.get(saved.id)!;
    assert.equal(stored["oql"], "SELECT Server WHERE nb_u > 4");
    assert.equal(stored["fields"], "name,nb_u");
    assert.equal(stored["owner_id"], 42);
    assert.equal(saved.mode, "conditions");
  });

  it("writes an administrator's changes as the administrator", async () => {
    const { service, calls } = fakeItop(SEED);
    await runAs(admin(), () => service.update(4, { name: "Bob's servers", recordType: "Server", conditions: [] }));
    assert.equal(calls.find((c) => c.verb === "core/update")!.as, "admin");
  });

  it("keeps staff to their own condition queries", async () => {
    const { service } = fakeItop(SEED);
    const input = { name: "x", recordType: "Server" };
    await assert.rejects(runAs(caller(), () => service.update(4, input)), /owner or an administrator/);
    await assert.rejects(runAs(caller(), () => service.update(2, input)), /Only administrators/);
    await assert.rejects(runAs(caller(), () => service.remove(3)), /Only administrators/);
    await runAs(caller(), () => service.remove(1));
  });

  it("refuses OQL from anyone but an administrator", async () => {
    const { service, calls } = fakeItop(SEED);
    await assert.rejects(
      runAs(caller(), () => service.create({ name: "x", oql: "SELECT Server" })),
      (error: AppError) => error.code === "forbidden",
    );
    await assert.rejects(
      runAs(caller(), () => service.runDraft({ name: "", oql: "SELECT Server" }, { page: 1, limit: 5 })),
      (error: AppError) => error.code === "forbidden",
    );
    assert.equal(calls.length, 0, "nothing reached iTop");
  });

  it("has iTop check an administrator's OQL first, and shows iTop's own reason", async () => {
    const { service, calls, queries } = fakeItop(SEED);
    const before = queries.size;
    await assert.rejects(
      runAs(admin(), () => service.create({ name: "bad", oql: "SELECT Server WHERE id IN (SELECT BROKEN)" })),
      (error: AppError) => error.code === "bad_request" && /iTop cannot run this query: Unknown class 'BROKEN'/.test(error.message),
    );
    assert.equal(queries.size, before, "nothing saved");
    assert.equal(calls[0]!.params["limit"], 1);
    assert.equal(calls[0]!.as, "admin");

    const saved = await runAs(admin(), () => service.create({ name: "ok", oql: "SELECT Server WHERE nb_u > 1", columns: ["name"] }));
    assert.equal(saved.oql, "SELECT Server WHERE nb_u > 1");
  });

  it("refuses OQL listing something the platform cannot show", async () => {
    const { service } = fakeItop(SEED);
    await assert.rejects(runAs(admin(), () => service.create({ name: "x", oql: "SELECT Nothing" })), /no screens for/);
  });

  it("refuses date conditions and unknown columns", async () => {
    const { service } = fakeItop(SEED);
    await assert.rejects(
      runAs(caller(), () =>
        service.create({ name: "x", recordType: "Server", conditions: [{ field: "purchase_date", op: "gt", value: "2026-01-01" }] }),
      ),
      /Dates cannot/,
    );
    await assert.rejects(
      runAs(caller(), () => service.create({ name: "x", recordType: "Server", columns: ["nope"] })),
      /no column "nope"/,
    );
  });

  it("runs a draft without saving it, as the caller", async () => {
    const { service, calls } = fakeItop(SEED);
    const result = await runAs(caller(), () =>
      service.runDraft({ name: "", recordType: "Server", conditions: [{ field: "name", op: "contains", value: "web" }] }, { page: 1, limit: 5 }),
    );
    assert.equal(result.total, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.as, "alice");
    assert.equal(calls[0]!.params["key"], "SELECT Server WHERE name LIKE '%web%'");
  });

  it("names the records key conditions point at, read as the caller", async () => {
    const { service, calls } = fakeItop({
      9: { name: "Demo servers", oql: "SELECT Server WHERE org_id IN (3)", fields: "", is_template: "no", owner_id: 42 },
    });
    const dto = await runAs(caller(), () => service.get(9));
    assert.deepEqual(dto.valueLabels, { "org_id:3": "Demo" });
    assert.equal(calls.find((c) => c.params["class"] === "Organization")!.as, "alice");
  });
});
