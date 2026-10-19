import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { criterionToOql, parseCriteriaParam } from "../src/platform/objects/criteria.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { FakeItopClient, getResponse, sampleSchema } from "./helpers.js";

const server = sampleSchema().require("Server");
const oql = (c: Parameters<typeof criterionToOql>[1]) => criterionToOql(server, c);
const rejects400 = (fn: () => unknown) =>
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.status === 400);

describe("criterionToOql", () => {
  it("translates text operators with LIKE escaping", () => {
    assert.equal(oql({ field: "name", op: "contains", value: "web" }), "name LIKE '%web%'");
    assert.equal(oql({ field: "name", op: "starts_with", value: "50%" }), String.raw`name LIKE '50\\%%'`);
    assert.equal(oql({ field: "name", op: "not_equals", value: "x" }), "name != 'x'");
  });

  it("checks enum values against the datamodel", () => {
    assert.equal(
      oql({ field: "status", op: "in", values: ["production", "stock"] }),
      "status IN ('production', 'stock')",
    );
    rejects400(() => oql({ field: "status", op: "in", values: ["bogus"] }));
  });

  it("takes only numeric ids for a picker, and 0 as empty", () => {
    assert.equal(oql({ field: "org_id", op: "not_in", values: [3, "4"] }), "org_id NOT IN (3, 4)");
    assert.equal(oql({ field: "org_id", op: "empty" }), "org_id = 0");
    rejects400(() => oql({ field: "org_id", op: "in", values: ["1) OR (1=1"] }));
  });

  it("widens a bare day to the whole day", () => {
    assert.equal(
      oql({ field: "purchase_date", op: "between", value: "2026-01-01", value2: "2026-01-31" }),
      "(purchase_date >= '2026-01-01 00:00:00' AND purchase_date <= '2026-01-31 23:59:59')",
    );
    rejects400(() => oql({ field: "purchase_date", op: "gt", value: "yesterday" }));
  });

  it("refuses an operator the field's kind does not take", () => {
    rejects400(() => oql({ field: "nb_u", op: "contains", value: "1" }));
    rejects400(() => oql({ field: "status", op: "gt", value: "a" }));
  });

  it("quotes text so it cannot break out of the literal", () => {
    assert.equal(oql({ field: "name", op: "equals", value: "x' OR '1'='1" }), String.raw`name = 'x\' OR \'1\'=\'1'`);
  });

  it("rejects attributes the class does not have", () => {
    rejects400(() => oql({ field: "nope", op: "empty" }));
    rejects400(() => oql({ field: "name OR 1", op: "empty" }));
  });
});

describe("criteria in a list", () => {
  it("ANDs criteria with the search and keeps a view nested", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const service = new ObjectsService(fake.asClient(), sampleSchema(), "test");
    await service.list("Server", {
      page: 1,
      limit: 10,
      oql: "SELECT Server WHERE status = 'production'",
      criteria: parseCriteriaParam(JSON.stringify([{ field: "nb_u", op: "gte", value: 2 }])),
    });
    assert.equal(
      fake.lastCall().params["key"],
      "SELECT Server WHERE (nb_u >= 2) AND (id IN (SELECT Server WHERE status = 'production'))",
    );
  });

  it("rejects malformed criteria JSON", () => {
    rejects400(() => parseCriteriaParam("not json"));
    rejects400(() => parseCriteriaParam(JSON.stringify([{ field: "name", op: "drop" }])));
  });
});
