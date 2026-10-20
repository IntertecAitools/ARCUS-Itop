import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { conditionsToFilter, filterToConditions } from "../src/platform/admin/conditions.js";
import type { Criterion } from "../src/platform/objects/criteria.js";
import { CmdbSchema } from "../src/schema/load.js";

const schema = CmdbSchema.fromFile(fileURLToPath(new URL("../../cmdb-schema/cmdb-schema.json", import.meta.url)));
const request = schema.get("UserRequest")!;

const roundTrip = (conditions: Criterion[]) => filterToConditions(request, conditionsToFilter(request, conditions));

describe("notification conditions", () => {
  it("writes conditions as the trigger's filter on the rule's own class", () => {
    assert.equal(
      conditionsToFilter(request, [
        { field: "priority", op: "in", values: ["1", "2"] },
        { field: "org_id", op: "in", values: ["3"] },
      ]),
      "SELECT UserRequest WHERE priority IN ('1', '2') AND org_id IN (3)",
    );
    assert.equal(conditionsToFilter(request, []), "");
  });

  it("reads back every kind of condition it writes", () => {
    const conditions: Criterion[] = [
      { field: "priority", op: "not_in", values: ["4"] },
      { field: "org_id", op: "in", values: ["1", "7"] },
      { field: "agent_id", op: "empty" },
      { field: "team_id", op: "not_empty" },
      { field: "title", op: "contains", value: "it's 50% done_now" },
      { field: "title", op: "not_contains", value: "test" },
      { field: "title", op: "starts_with", value: "VPN" },
      { field: "title", op: "ends_with", value: "down" },
      { field: "title", op: "equals", value: "Printer" },
      { field: "title", op: "not_equals", value: "Fax" },
      { field: "origin", op: "empty" },
      { field: "origin", op: "not_empty" },
    ];
    assert.deepEqual(roundTrip(conditions), { conditions, kept: [] });
  });

  it("keeps what it cannot show, and writes it back ANDed with new conditions", () => {
    const parsed = filterToConditions(
      request,
      "SELECT UserRequest WHERE priority IN ('1') AND (caller_id = 5 OR agent_id = 5) AND start_date > '2026-01-01 00:00:00'",
    );
    assert.deepEqual(parsed.conditions, [{ field: "priority", op: "in", values: ["1"] }]);
    assert.deepEqual(parsed.kept, ["caller_id = 5 OR agent_id = 5", "start_date > '2026-01-01 00:00:00'"]);
    assert.equal(
      conditionsToFilter(request, [{ field: "org_id", op: "in", values: ["2"] }], parsed.kept),
      "SELECT UserRequest WHERE org_id IN (2) AND (caller_id = 5 OR agent_id = 5) AND (start_date > '2026-01-01 00:00:00')",
    );
  });

  it("keeps a filter of another shape whole, and refuses to combine it", () => {
    const filter = "SELECT UserRequest AS r JOIN Organization AS o ON r.org_id = o.id WHERE o.name = 'Acme'";
    const parsed = filterToConditions(request, filter);
    assert.deepEqual(parsed, { conditions: [], kept: [filter] });
    assert.equal(conditionsToFilter(request, [], parsed.kept), filter);
    assert.throws(
      () => conditionsToFilter(request, [{ field: "priority", op: "in", values: ["1"] }], parsed.kept),
      /cannot be combined/,
    );
  });

  it("does not split on an AND inside quotes or brackets", () => {
    const parsed = filterToConditions(request, "SELECT UserRequest WHERE title = 'A AND B' AND (x = 1 AND y = 2)");
    assert.deepEqual(parsed.conditions, [{ field: "title", op: "equals", value: "A AND B" }]);
    assert.deepEqual(parsed.kept, ["x = 1 AND y = 2"]);
  });

  it("refuses values a field cannot take", () => {
    assert.throws(() => conditionsToFilter(request, [{ field: "priority", op: "in", values: ["9"] }]), /must be one of/);
    assert.throws(() => conditionsToFilter(request, [{ field: "org_id", op: "in", values: ["1 OR 1=1"] }]), /record id/);
  });
});
