import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ItopClient } from "../src/itop/client.js";
import { AuditService } from "../src/platform/admin/audit.service.js";
import { sampleSchema } from "./helpers.js";

type Fields = Record<string, unknown>;
type Write = { verb: string; class: string; key?: unknown; fields?: Fields };

/**
 * A small in-memory iTop: core/get answers the queries the audit service
 * makes (by id, by category, every row), and writes change the tables.
 */
function memoryItop(seed: Record<string, Record<number, Fields>>) {
  const tables: Record<string, Map<number, Fields>> = {};
  for (const [cls, rows] of Object.entries(seed)) {
    tables[cls] = new Map(Object.entries(rows).map(([id, f]) => [Number(id), { ...f }]));
  }
  const table = (cls: string) => (tables[cls] ??= new Map());
  let nextId = 1000;
  const writes: Write[] = [];
  const client = {
    async call(verb: string, params: Record<string, unknown>) {
      const cls = String(params["class"]);
      const key = params["key"];
      if (verb === "core/get") {
        let rows = [...table(cls)];
        const text = String(key);
        const byId = typeof key === "number" ? String(key) : /WHERE id = (\d+)$/.exec(text)?.[1];
        if (byId !== undefined) rows = rows.filter(([id]) => id === Number(byId));
        const byIds = /WHERE id IN \(([\d,]+)\)$/.exec(text)?.[1];
        if (byIds) rows = rows.filter(([id]) => byIds.split(",").map(Number).includes(id));
        const byCategory = /WHERE category_id = (\d+)$/.exec(text)?.[1];
        if (byCategory) rows = rows.filter(([, f]) => String(f["category_id"]) === byCategory);
        return {
          code: 0,
          message: "",
          objects: Object.fromEntries(
            rows.map(([id, f]) => [`${cls}::${id}`, { code: 0, message: "", class: cls, key: String(id), fields: f }]),
          ),
        };
      }
      const fields = params["fields"] as Fields | undefined;
      writes.push({ verb, class: cls, key, ...(fields ? { fields } : {}) });
      if (verb === "core/create") {
        const id = nextId++;
        table(cls).set(id, { ...fields });
        return { code: 0, message: "", objects: { [`${cls}::${id}`]: { code: 0, message: "", class: cls, key: String(id), fields: {} } } };
      }
      if (verb === "core/update") {
        const id = Number(key);
        table(cls).set(id, { ...table(cls).get(id), ...fields });
        return { code: 0, message: "", objects: {} };
      }
      if (verb === "core/delete") {
        table(cls).delete(Number(key));
        return { code: 0, message: "", objects: {} };
      }
      throw new Error(`unexpected ${verb}`);
    },
  };
  return { client: client as unknown as ItopClient, tables, writes };
}

const seed = () => ({
  AuditDomain: { 1: { name: "Infrastructure", description: "" }, 2: { name: "Finance", description: "" } },
  lnkAuditCategoryToAuditDomain: { 5: { category_id: 10, domain_id: 1 } },
  AuditCategory: {
    10: {
      name: "Production servers",
      description: "",
      definition_set: "SELECT Server WHERE status IN ('production')",
      ok_error_tolerance: "5",
      warning_error_tolerance: "25",
    },
    11: {
      name: "Servers of one customer",
      description: "",
      // Set up in iTop: a join this screen cannot show.
      definition_set: "SELECT Server AS s JOIN Organization AS o ON s.org_id = o.id WHERE o.name = 'Acme'",
      ok_error_tolerance: "5",
      warning_error_tolerance: "25",
    },
  },
  AuditRule: {
    20: {
      name: "No organization",
      description: "",
      query: "SELECT Server WHERE org_id IN (3) AND (nb_u > 4 OR nb_u = 0)",
      valid_flag: "false",
      category_id: 10,
    },
  },
  Organization: { 3: { friendlyname: "Demo" } },
});

const service = (client: ItopClient) => new AuditService(client, sampleSchema());

describe("audit editing", () => {
  it("shows a category as a record type and conditions", async () => {
    const { client } = memoryItop(seed());
    const form = await service(client).getCategory(10);
    assert.equal(form.recordType, "Server");
    assert.deepEqual(form.conditions, [{ field: "status", op: "in", values: ["production"] }]);
    assert.equal(form.keptCondition, false);
    assert.deepEqual(form.domains, [1]);
    assert.ok(!JSON.stringify(form).includes("SELECT"));
  });

  it("shows a rule's conditions, keeps what it cannot show, and names the records conditions point at", async () => {
    const { client } = memoryItop(seed());
    const form = await service(client).getRule(20);
    assert.equal(form.categoryId, 10);
    assert.equal(form.lists, "faulty");
    assert.deepEqual(form.conditions, [{ field: "org_id", op: "in", values: ["3"] }]);
    assert.equal(form.keptCondition, true);
    assert.deepEqual(form.valueLabels, { "org_id:3": "Demo" });
    assert.ok(!JSON.stringify(form).includes("SELECT"));
  });

  it("creates a category over a record type, with its tolerances and domains", async () => {
    const { client, tables } = memoryItop(seed());
    const created = await service(client).createCategory({
      name: " Rack servers ",
      recordType: "Server",
      conditions: [{ field: "nb_u", op: "gt", value: "0" }],
      tolerance: { good: 10, warning: 30 },
      domains: [2],
    });
    const stored = tables["AuditCategory"]!.get(created.id)!;
    assert.equal(stored["name"], "Rack servers");
    assert.equal(stored["definition_set"], "SELECT Server WHERE nb_u > 0");
    assert.equal(stored["ok_error_tolerance"], 10);
    assert.deepEqual(created.domains, [2]);
    assert.deepEqual(created.conditions, [{ field: "nb_u", op: "gt", value: "0" }]);
  });

  it("writes a category without conditions as every record of the type", async () => {
    const { client, tables } = memoryItop(seed());
    const created = await service(client).createCategory({ name: "All servers", recordType: "Server" });
    assert.equal(tables["AuditCategory"]!.get(created.id)!["definition_set"], "SELECT Server");
    assert.deepEqual(created.conditions, []);
    assert.equal(created.keptCondition, false);
  });

  it("refuses bad input before writing anything", async () => {
    const { client, writes } = memoryItop(seed());
    const s = service(client);
    await assert.rejects(s.createCategory({ name: "", recordType: "Server" }), /name/);
    await assert.rejects(s.createCategory({ name: "x", recordType: "Nope" }), /Unknown kind/);
    await assert.rejects(
      s.createCategory({ name: "x", recordType: "Server", tolerance: { good: 50, warning: 10 } }),
      /Tolerances/,
    );
    await assert.rejects(s.createCategory({ name: "x", recordType: "Server", domains: [99] }), /No audit domain 99/);
    await assert.rejects(
      s.createCategory({
        name: "x",
        recordType: "Server",
        conditions: [{ field: "purchase_date", op: "lt", value: "2020-01-01" }],
      }),
      /Dates/,
    );
    await assert.rejects(s.createRule({ categoryId: 10, name: "x", lists: "faulty", conditions: [] }), /at least one condition/);
    assert.equal(writes.length, 0);
  });

  it("edits a category and moves it between domains", async () => {
    const { client, tables, writes } = memoryItop(seed());
    const updated = await service(client).updateCategory(10, {
      name: "Production servers",
      recordType: "Server",
      conditions: [{ field: "status", op: "in", values: ["production", "implementation"] }],
      domains: [2],
    });
    assert.equal(
      tables["AuditCategory"]!.get(10)!["definition_set"],
      "SELECT Server WHERE status IN ('production', 'implementation')",
    );
    assert.deepEqual(updated.domains, [2]);
    assert.ok(writes.some((w) => w.verb === "core/delete" && w.class === "lnkAuditCategoryToAuditDomain" && w.key === 5));
  });

  it("keeps a definition set up in iTop whole, unless it is dropped", async () => {
    const { client, tables } = memoryItop(seed());
    const s = service(client);
    const form = await s.getCategory(11);
    assert.equal(form.keptCondition, true);
    assert.deepEqual(form.conditions, []);
    await s.updateCategory(11, { name: "Renamed", recordType: "Server" });
    assert.match(String(tables["AuditCategory"]!.get(11)!["definition_set"]), /JOIN Organization/);
    await assert.rejects(
      s.updateCategory(11, { name: "Renamed", recordType: "Server", conditions: [{ field: "nb_u", op: "gt", value: "1" }] }),
      /cannot be combined/,
    );
    await s.updateCategory(11, { name: "Renamed", recordType: "Server", keepCondition: false });
    assert.equal(tables["AuditCategory"]!.get(11)!["definition_set"], "SELECT Server");
  });

  it("does not change the record type of a category that has rules", async () => {
    const { client } = memoryItop(seed());
    await assert.rejects(
      service(client).updateCategory(10, { name: "x", recordType: "Organization" }),
      /Delete this category's rules/,
    );
  });

  it("creates and edits a rule on its category's record type", async () => {
    const { client, tables } = memoryItop(seed());
    const s = service(client);
    const rule = await s.createRule({
      categoryId: 10,
      name: "Has a name",
      lists: "valid",
      conditions: [{ field: "name", op: "not_empty" }],
    });
    const stored = tables["AuditRule"]!.get(rule.id)!;
    assert.equal(stored["query"], "SELECT Server WHERE name != ''");
    assert.equal(stored["valid_flag"], "true");
    assert.equal(stored["category_id"], 10);
    assert.deepEqual(rule.conditions, [{ field: "name", op: "not_empty" }]);

    await s.updateRule(rule.id, { categoryId: 10, name: "No name", lists: "faulty", conditions: [{ field: "name", op: "empty" }] });
    assert.equal(tables["AuditRule"]!.get(rule.id)!["valid_flag"], "false");
  });

  it("keeps the part of a rule set up in iTop when its conditions change", async () => {
    const { client, tables } = memoryItop(seed());
    await service(client).updateRule(20, {
      categoryId: 10,
      name: "No organization",
      lists: "faulty",
      conditions: [{ field: "org_id", op: "in", values: ["4"] }],
    });
    assert.equal(tables["AuditRule"]!.get(20)!["query"], "SELECT Server WHERE org_id IN (4) AND (nb_u > 4 OR nb_u = 0)");
  });

  it("names the rules that go with a category before deleting it", async () => {
    const { client, tables, writes } = memoryItop(seed());
    const s = service(client);
    await assert.rejects(s.deleteCategory(10), (e: Error & { code?: string; details?: unknown }) => {
      assert.equal(e.code, "conflict");
      assert.match(e.message, /1 rule, deleted with it: No organization/);
      assert.deepEqual(e.details, { rules: [{ id: 20, name: "No organization" }] });
      return true;
    });
    assert.equal(writes.length, 0);
    const result = await s.deleteCategory(10, true);
    assert.deepEqual(result.deletedRules, [{ id: 20, name: "No organization" }]);
    // Rules first: iTop refuses to delete a category that still has them.
    assert.deepEqual(
      writes.map((w) => [w.class, w.key]),
      [
        ["AuditRule", 20],
        ["AuditCategory", 10],
      ],
    );
    assert.equal(tables["AuditCategory"]!.has(10), false);
  });

  it("deletes an empty category and a rule without asking", async () => {
    const { client, tables } = memoryItop(seed());
    const s = service(client);
    await s.deleteCategory(11);
    assert.equal(tables["AuditCategory"]!.has(11), false);
    await s.deleteRule(20);
    assert.equal(tables["AuditRule"]!.has(20), false);
    await assert.rejects(s.deleteRule(20), /not found/);
  });

  it("creates, renames and deletes domains", async () => {
    const { client, tables } = memoryItop(seed());
    const s = service(client);
    const domain = await s.createDomain({ name: "Network" });
    assert.equal(domain.name, "Network");
    assert.equal((await s.updateDomain(domain.id, { name: "Networks", description: "LAN" })).description, "LAN");
    await s.deleteDomain(domain.id);
    assert.equal(tables["AuditDomain"]!.has(domain.id), false);
    await assert.rejects(s.createDomain({ name: " " }), /name/);
  });

  it("offers record types, CIs first", async () => {
    const { client } = memoryItop(seed());
    const { recordTypes } = service(client).options();
    assert.equal(recordTypes[0]?.name, "Server");
    assert.ok(recordTypes.some((t) => t.name === "Organization" && !t.ci));
  });
});
