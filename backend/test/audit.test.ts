import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import type { ItopClient } from "../src/itop/client.js";
import {
  AuditService,
  failingRecords,
  MAX_RECORDS_PER_RULE,
  selectedClass,
  statusFor,
} from "../src/platform/admin/audit.service.js";
import { sampleSchema } from "./helpers.js";

describe("selectedClass", () => {
  it("reads the class a query selects", () => {
    assert.equal(selectedClass("SELECT Server"), "Server");
    assert.equal(selectedClass("  select Server WHERE status = 'production'"), "Server");
    assert.equal(selectedClass("SELECT Server AS s JOIN Organization AS o ON s.org_id = o.id"), "Server");
    assert.equal(selectedClass("SELECT s FROM Server AS s JOIN Organization AS o ON s.org_id = o.id"), "Server");
    assert.equal(selectedClass("SELECT o FROM Server AS s JOIN Organization AS o ON s.org_id = o.id"), "Organization");
    assert.equal(selectedClass("nonsense"), null);
  });
});

describe("statusFor", () => {
  const tolerance = { good: 5, warning: 25 };
  it("uses the category's tolerances like iTop", () => {
    assert.equal(statusFor(0, 0, tolerance), "good");
    assert.equal(statusFor(100, 5, tolerance), "good");
    assert.equal(statusFor(100, 6, tolerance), "warning");
    assert.equal(statusFor(100, 25, tolerance), "warning");
    assert.equal(statusFor(100, 26, tolerance), "bad");
  });
});

const obj = (cls: string, id: number, name = `${cls}-${id}`): Row => ({
  class: cls,
  id,
  code: 0,
  message: "",
  fields: { friendlyname: name },
});

describe("failingRecords", () => {
  const set = [obj("Server", 1), obj("Server", 2), obj("Server", 3)];
  it("fails the returned records of the set when the rule lists faulty ones", () => {
    // Record 9 is outside the set: iTop intersects with the set, so it is ignored.
    assert.deepEqual(failingRecords(set, [obj("Server", 2), obj("Server", 9)], "faulty").map((o) => o.id), [2]);
  });
  it("fails the records not returned when the rule lists valid ones", () => {
    assert.deepEqual(failingRecords(set, [obj("Server", 2)], "valid").map((o) => o.id), [1, 3]);
    assert.equal(failingRecords(set, [], "valid").length, 3);
  });
  it("compares class and id, not id alone", () => {
    assert.deepEqual(failingRecords(set, [obj("Person", 1)], "faulty"), []);
  });
});

type Row = { class: string; id: number; code: number; message: string; fields: Record<string, unknown> };

/** Answers core/get by class and query, from fixed tables. */
function fakeItop(tables: Record<string, Row[]>, failing: Set<string> = new Set()) {
  const calls: Array<{ class: string; key: unknown }> = [];
  const client = {
    async call(verb: string, params: Record<string, unknown>) {
      assert.equal(verb, "core/get");
      const cls = String(params["class"]);
      const key = params["key"];
      calls.push({ class: cls, key });
      if (typeof key === "string" && failing.has(key)) throw new AppError("upstream_error", "OQL error");
      let rows = tables[typeof key === "string" && tables[key] ? key : cls] ?? [];
      const byId = typeof key === "number" ? key : /WHERE id = (\d+)$/.exec(String(key))?.[1];
      if (byId !== undefined) rows = rows.filter((r) => r.id === Number(byId));
      const byCategory = /WHERE category_id = (\d+)$/.exec(String(key))?.[1];
      if (byCategory) rows = rows.filter((r) => String(r.fields["category_id"]) === byCategory);
      return {
        code: 0,
        message: `Found: ${rows.length}`,
        objects: Object.fromEntries(
          rows.map((r) => [`${r.class}::${r.id}`, { code: 0, message: "", class: r.class, key: String(r.id), fields: r.fields }]),
        ),
      };
    },
  };
  return { client: client as unknown as ItopClient, calls };
}

const row = (cls: string, id: number, fields: Record<string, unknown>) => ({ class: cls, id, code: 0, message: "", fields });

const DEFINITION = "SELECT Server";
const NO_SERIAL = "SELECT Server WHERE serialnumber = ''";
const HAS_OWNER = "SELECT FunctionalCI WHERE owner_id != 0";
const BROKEN = "SELECT Server WHERE nope = 1";

const tables: Record<string, Row[]> = {
  AuditDomain: [row("AuditDomain", 1, { name: "Infrastructure", description: "" })],
  lnkAuditCategoryToAuditDomain: [row("lnkAuditCategoryToAuditDomain", 1, { category_id: 10, domain_id: 1 })],
  AuditCategory: [
    row("AuditCategory", 10, {
      name: "Servers",
      description: "All servers",
      definition_set: DEFINITION,
      ok_error_tolerance: "5",
      warning_error_tolerance: "50",
    }),
  ],
  AuditRule: [
    row("AuditRule", 20, { name: "Serial number filled", description: "", query: NO_SERIAL, valid_flag: "false", category_id: 10 }),
    row("AuditRule", 21, { name: "Has an owner", description: "", query: HAS_OWNER, valid_flag: "true", category_id: 10 }),
    row("AuditRule", 22, { name: "Broken", description: "", query: BROKEN, valid_flag: "false", category_id: 10 }),
  ],
  [DEFINITION]: [obj("Server", 1, "srv-a"), obj("Server", 2, "srv-b"), obj("Server", 3, "srv-c"), obj("Server", 4, "srv-d")],
  [NO_SERIAL]: [obj("Server", 2, "srv-b")],
  // Valid records: servers 1, 2 and a network device outside the set.
  [HAS_OWNER]: [obj("Server", 1), obj("Server", 2), obj("NetworkDevice", 3)],
};

describe("AuditService", () => {
  it("lists domains and categories with their rules, without queries", async () => {
    const { client } = fakeItop(tables);
    const overview = await new AuditService(client, sampleSchema()).overview();
    assert.deepEqual(overview.domains, [{ id: 1, name: "Infrastructure", description: "", categories: [10] }]);
    const [category] = overview.categories;
    assert.equal(category?.recordType, "Server");
    assert.deepEqual(category?.tolerance, { good: 5, warning: 50 });
    assert.deepEqual(category?.domains, [1]);
    assert.deepEqual(
      category?.rules.map((r) => [r.id, r.name, r.lists]),
      [
        [22, "Broken", "faulty"],
        [21, "Has an owner", "valid"],
        [20, "Serial number filled", "faulty"],
      ],
    );
    assert.ok(!JSON.stringify(overview).includes("SELECT"));
  });

  it("runs a category: counts per rule, the union overall, and a rule that fails to run", async () => {
    const { client } = fakeItop(tables, new Set([BROKEN]));
    const result = await new AuditService(client, sampleSchema()).runCategory(10);
    assert.equal(result.total, 4);
    const byName = Object.fromEntries(result.rules.map((r) => [r.name, r]));
    assert.equal(byName["Serial number filled"]?.failing, 1);
    assert.deepEqual(byName["Serial number filled"]?.records, [{ id: 2, class: "Server", name: "srv-b" }]);
    assert.equal(byName["Serial number filled"]?.percentOk, 75);
    assert.equal(byName["Serial number filled"]?.status, "warning");
    assert.deepEqual(byName["Has an owner"]?.records.map((r) => r.id), [3, 4]);
    assert.equal(byName["Has an owner"]?.status, "warning");
    assert.match(byName["Broken"]?.error ?? "", /could not be run/);
    assert.equal(byName["Broken"]?.failing, 0);
    // Servers 2, 3 and 4 fail something.
    assert.equal(result.failing, 3);
    assert.equal(result.percentOk, 25);
    assert.equal(result.status, "bad");
    assert.ok(!JSON.stringify(result).includes("SELECT"));
  });

  it("runs one rule against its category's set", async () => {
    const { client } = fakeItop(tables);
    const result = await new AuditService(client, sampleSchema()).runRule(21);
    assert.deepEqual(result.rules.map((r) => r.id), [21]);
    assert.equal(result.failing, 2);
  });

  it("does not run rules over an empty set", async () => {
    const { client, calls } = fakeItop({ ...tables, [DEFINITION]: [] });
    const result = await new AuditService(client, sampleSchema()).runCategory(10);
    assert.equal(result.total, 0);
    assert.ok(result.rules.every((r) => r.failing === 0 && r.status === "good"));
    assert.ok(!calls.some((c) => c.key === NO_SERIAL));
  });

  it("reports a set that cannot be read", async () => {
    const { client } = fakeItop(tables, new Set([DEFINITION]));
    const result = await new AuditService(client, sampleSchema()).runCategory(10);
    assert.match(result.error ?? "", /could not be read/);
    assert.deepEqual(result.rules, []);
  });

  it("lists at most a fixed number of failing records, but counts them all", async () => {
    const many = Array.from({ length: MAX_RECORDS_PER_RULE + 3 }, (_, i) => obj("Server", i + 1));
    const { client } = fakeItop({ ...tables, [DEFINITION]: many, [NO_SERIAL]: many });
    const result = await new AuditService(client, sampleSchema()).runRule(20);
    assert.equal(result.rules[0]?.failing, MAX_RECORDS_PER_RULE + 3);
    assert.equal(result.rules[0]?.records.length, MAX_RECORDS_PER_RULE);
    assert.equal(result.rules[0]?.truncated, true);
  });

  it("rethrows transport failures instead of hiding them as rule errors", async () => {
    const client = {
      async call() {
        throw new AppError("upstream_unavailable", "down");
      },
    } as unknown as ItopClient;
    await assert.rejects(new AuditService(client, sampleSchema()).overview(), /down/);
  });

  it("answers 404 for an unknown category or rule", async () => {
    const { client } = fakeItop(tables);
    const service = new AuditService(client, sampleSchema());
    await assert.rejects(service.runCategory(99), /not found/);
    await assert.rejects(service.runRule(99), /not found/);
  });
});
