import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { ObjectsService, SORT_ROW_CAP, compareValues } from "../src/platform/objects/objects.service.js";
import { FakeItopClient, getResponse, sampleSchema } from "./helpers.js";

function service(fake: FakeItopClient): ObjectsService {
  return new ObjectsService(fake.asClient(), sampleSchema(), "bff-test");
}

describe("ObjectsService.list", () => {
  it("passes pagination straight to iTop and reports the real total", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Server", id: 1, fields: { friendlyname: "srv-01" } }], 137),
    );

    const result = await service(fake).list("Server", { page: 2, limit: 50 });

    assert.equal(fake.lastCall().params["limit"], 50);
    assert.equal(fake.lastCall().params["page"], 2);
    assert.equal(result.total, 137);
    assert.equal(result.pages, 3);
    assert.equal(result.hasMore, true);
    assert.equal(result.sortedInBff, false);
  });

  it("reports hasMore false on the last page", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 100));
    const result = await service(fake).list("Server", { page: 2, limit: 50 });
    assert.equal(result.hasMore, false);
  });

  it("builds a label from friendlyname, falling back to name", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([
        { class: "Server", id: 1, fields: { friendlyname: "srv-01", name: "ignored" } },
        { class: "Server", id: 2, fields: { name: "srv-02" } },
        { class: "Server", id: 3, fields: {} },
      ]),
    );
    const result = await service(fake).list("Server", { page: 1, limit: 50 });
    assert.deepEqual(
      result.items.map((i) => i.label),
      ["srv-01", "srv-02", "Server::3"],
    );
  });

  it("turns unreserved filters into OQL equality conditions", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).list("Server", {
      page: 1,
      limit: 10,
      filters: { status: "production", org_id: "3" },
    });
    assert.equal(
      fake.lastCall().params["key"],
      "SELECT Server WHERE status = 'production' AND org_id = 3",
    );
  });

  it("rejects a filter value outside an enum", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () => service(fake).list("Server", { page: 1, limit: 10, filters: { status: "nope" } }),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("rejects a non-numeric value for a picker filter", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () => service(fake).list("Server", { page: 1, limit: 10, filters: { org_id: "abc" } }),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("refuses to filter on a link set", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () =>
        service(fake).list("Server", {
          page: 1,
          limit: 10,
          filters: { softwares_list: "x" },
        }),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("asks only for summary fields by default", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).list("Server", { page: 1, limit: 10 });
    const outputFields = String(fake.lastCall().params["output_fields"]).split(",");
    assert.ok(outputFields.includes("id"));
    assert.ok(outputFields.includes("friendlyname"));
    // A link set would make the list query do a nested fetch per row.
    assert.ok(!outputFields.includes("softwares_list"));
  });

  it("excludes link sets from fields=full", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).list("Server", { page: 1, limit: 10, fields: "full" });
    const outputFields = String(fake.lastCall().params["output_fields"]).split(",");
    assert.ok(!outputFields.includes("softwares_list"));
    assert.ok(outputFields.includes("brand_name"), "read-only fields are still readable");
  });

  it("maps fields=all onto iTop's * wildcard", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).list("Server", { page: 1, limit: 10, fields: "all" });
    assert.equal(fake.lastCall().params["output_fields"], "*");
  });

  it("always includes id and friendlyname in an explicit field list", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).list("Server", { page: 1, limit: 10, fields: "status" });
    const outputFields = String(fake.lastCall().params["output_fields"]).split(",");
    assert.deepEqual(outputFields.sort(), ["friendlyname", "id", "status"]);
  });

  it("rejects an unknown attribute in fields", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () => service(fake).list("Server", { page: 1, limit: 10, fields: "bogus" }),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("caps limit at the maximum page size", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).list("Server", { page: 1, limit: 99_999 });
    assert.equal(fake.lastCall().params["limit"], 500);
  });
});

describe("ObjectsService.list sorting", () => {
  it("sorts in the BFF because iTop cannot sort", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse(
        [
          { class: "Server", id: 1, fields: { friendlyname: "b", nb_u: "2" } },
          { class: "Server", id: 2, fields: { friendlyname: "a", nb_u: "10" } },
          { class: "Server", id: 3, fields: { friendlyname: "c", nb_u: "1" } },
        ],
        3,
      ),
    );

    const result = await service(fake).list("Server", {
      page: 1,
      limit: 10,
      sort: "nb_u",
      order: "asc",
    });

    assert.equal(result.sortedInBff, true);
    assert.deepEqual(result.items.map((i) => i.id), [3, 1, 2], "numeric, not lexicographic");
    // The whole set has to be fetched to be sorted.
    assert.equal(fake.lastCall().params["limit"], SORT_ROW_CAP);
    assert.equal(fake.lastCall().params["page"], 1);
  });

  it("adds the sort key to output_fields so rows do not all compare equal", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 0));
    await service(fake).list("Server", { page: 1, limit: 10, sort: "nb_u", fields: "status" });
    const outputFields = String(fake.lastCall().params["output_fields"]).split(",");
    assert.ok(outputFields.includes("nb_u"));
    // And does not duplicate it when it is already present.
    assert.equal(outputFields.filter((f) => f === "nb_u").length, 1);
  });

  it("does not duplicate a sort key already in the field list", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 0));
    await service(fake).list("Server", { page: 1, limit: 10, sort: "status", fields: "status" });
    const outputFields = String(fake.lastCall().params["output_fields"]).split(",");
    assert.equal(outputFields.filter((f) => f === "status").length, 1);
  });

  it("slices the requested page out of the sorted set", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      class: "Server",
      id: index + 1,
      fields: { friendlyname: `srv-${String(10 - index).padStart(2, "0")}` },
    }));
    const fake = new FakeItopClient().on("core/get", getResponse(rows, 10));

    const result = await service(fake).list("Server", {
      page: 2,
      limit: 3,
      sort: "friendlyname",
    });

    assert.deepEqual(result.items.map((i) => i.label), ["srv-04", "srv-05", "srv-06"]);
    assert.equal(result.total, 10);
  });

  it("refuses to sort a result set larger than the cap", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], SORT_ROW_CAP + 1));
    await assert.rejects(
      () => service(fake).list("Server", { page: 1, limit: 10, sort: "name" }),
      (error: unknown) =>
        error instanceof AppError && error.status === 400 && /cannot sort/i.test(error.message),
    );
  });

  it("rejects sorting by an unknown or non-scalar attribute", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await assert.rejects(
      () => service(fake).list("Server", { page: 1, limit: 10, sort: "nope" }),
      AppError,
    );
    await assert.rejects(
      () => service(fake).list("Server", { page: 1, limit: 10, sort: "softwares_list" }),
      AppError,
    );
  });
});

describe("compareValues", () => {
  it("sorts numbers numerically", () => {
    assert.ok(compareValues(2, 10) < 0);
    assert.ok(compareValues("2", "10") < 0, "numeric strings too");
  });

  it("sorts strings naturally", () => {
    assert.ok(compareValues("srv-2", "srv-10") < 0);
  });

  it("puts empty values last ascending AND descending", () => {
    // A descending date column whose first page is all blanks is useless, so the
    // direction must not flip the empty-value tie-break.
    assert.ok(compareValues(null, 5) > 0);
    assert.ok(compareValues(null, 5, true) > 0);
    assert.ok(compareValues("", "a") > 0);
    assert.ok(compareValues("", "a", true) > 0);
    assert.equal(compareValues(null, ""), 0);
  });

  it("does not treat a blank string as the number zero", () => {
    // Number("") === 0, which would rank "" below every negative number.
    assert.ok(compareValues(" ", -5) > 0);
  });

  it("reverses non-empty comparisons when descending", () => {
    assert.ok(compareValues(2, 10, true) > 0);
  });
});

describe("ObjectsService.get", () => {
  it("sends a numeric key, avoiding OQL entirely", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Server", id: 7, fields: { friendlyname: "srv-07" } }]),
    );
    const dto = await service(fake).get("Server", 7);
    assert.equal(fake.lastCall().params["key"], 7);
    assert.equal(dto.id, 7);
    assert.equal(dto.label, "srv-07");
  });

  it("404s when iTop returns an empty object set", async () => {
    const fake = new FakeItopClient().on("core/get", { code: 0, message: "Found: 0", objects: null });
    await assert.rejects(
      () => service(fake).get("Server", 7),
      (error: unknown) => error instanceof AppError && error.status === 404,
    );
  });

  it("404s for a class absent from the schema", async () => {
    const fake = new FakeItopClient();
    await assert.rejects(
      () => service(fake).get("Nonexistent", 1),
      (error: unknown) => error instanceof AppError && error.status === 404,
    );
  });
});

describe("ObjectsService.create", () => {
  it("always sends the mandatory tracking comment", async () => {
    const fake = new FakeItopClient().on(
      "core/create",
      getResponse([{ class: "Server", id: 11, fields: { friendlyname: "srv-11" } }]),
    );

    await service(fake).create("Server", { name: "srv-11", org_id: 3 });

    // RestUtils::InitTrackingComment calls GetMandatoryParam('comment'), so
    // omitting it fails the entire call.
    assert.equal(fake.lastCall().params["comment"], "bff-test");
  });

  it("uses a caller-supplied comment when given", async () => {
    const fake = new FakeItopClient().on(
      "core/create",
      getResponse([{ class: "Server", id: 11, fields: {} }]),
    );
    await service(fake).create("Server", { name: "x", org_id: 3 }, { comment: "ticket 42" });
    assert.equal(fake.lastCall().params["comment"], "ticket 42");
  });

  it("falls back to the default when the comment is only whitespace", async () => {
    const fake = new FakeItopClient().on(
      "core/create",
      getResponse([{ class: "Server", id: 11, fields: {} }]),
    );
    await service(fake).create("Server", { name: "x", org_id: 3 }, { comment: "   " });
    assert.equal(fake.lastCall().params["comment"], "bff-test");
  });

  it("never forwards a read-only field to iTop", async () => {
    const fake = new FakeItopClient().on(
      "core/create",
      getResponse([{ class: "Server", id: 11, fields: {} }]),
    );

    await service(fake).create(
      "Server",
      { name: "srv-11", org_id: 3, brand_name: "Dell" },
      { strict: false },
    );

    const sent = fake.lastCall().params["fields"] as Record<string, unknown>;
    assert.ok(!("brand_name" in sent), "ExternalFields must be stripped before the write");
    assert.deepEqual(Object.keys(sent).sort(), ["name", "org_id"]);
  });

  it("refuses to instantiate an abstract class", async () => {
    const fake = new FakeItopClient();
    const schema = sampleSchema();
    // Mark Server abstract to exercise the guard without a second fixture.
    const info = schema.require("Server");
    const abstractSchema = Object.create(schema, {}) as typeof schema;
    Object.assign(info, { abstract: true });
    const svc = new ObjectsService(fake.asClient(), abstractSchema, "c");
    await assert.rejects(
      () => svc.create("Server", { name: "x", org_id: 1 }),
      (error: unknown) => error instanceof AppError && /abstract/.test(error.message),
    );
    Object.assign(info, { abstract: false });
  });
});

describe("ObjectsService.remove", () => {
  it("reports the deletion plan for a simulation without throwing", async () => {
    const fake = new FakeItopClient().on("core/delete", {
      code: 12, // RestResult::UNSAFE
      message: "SIMULATING: The deletion requires that other objects be deleted/updated",
      objects: {
        "Server::5": { code: 0, message: "", class: "Server", key: "5", fields: {} },
        "lnkX::9": {
          code: 4, // RestDelete::REQUEST_EXPLICITELY
          message: "Must be deleted explicitely",
          class: "lnkX",
          key: "9",
          fields: {},
        },
      },
    });

    const result = await service(fake).remove("Server", 5, { simulate: true });

    assert.equal(result.simulated, true);
    assert.equal(result.ok, false);
    assert.equal(result.plan.length, 2);
    assert.ok(result.plan.some((p) => p.outcome === "must be deleted explicitly"));
    assert.equal(fake.lastCall().params["simulate"], true);
  });

  it("throws 409 when a real delete would cascade", async () => {
    const fake = new FakeItopClient().on("core/delete", {
      code: 12,
      message: "The deletion requires that other objects be deleted/updated",
      objects: null,
    });

    await assert.rejects(
      () => service(fake).remove("Server", 5),
      (error: unknown) =>
        error instanceof AppError &&
        error.status === 409 &&
        /simulate=true/.test(error.message),
    );
  });

  it("returns ok for a clean delete", async () => {
    const fake = new FakeItopClient().on("core/delete", {
      code: 0,
      message: "Deleted: 1",
      objects: {
        "Server::5": { code: 0, message: "", class: "Server", key: "5", fields: {} },
      },
    });
    const result = await service(fake).remove("Server", 5);
    assert.equal(result.ok, true);
    assert.equal(result.plan[0]?.outcome, "deleted");
  });
});

describe("ObjectsService.applyStimulus", () => {
  it("refuses a class with no lifecycle", async () => {
    // No class in the compiled CMDB schema has one -- extract-schema.py reports
    // "lifecycles: none" -- so this is the expected path for every CI.
    const fake = new FakeItopClient();
    await assert.rejects(
      () => service(fake).applyStimulus("Server", 1, "ev_decommission", {}),
      (error: unknown) => error instanceof AppError && /lifecycle/.test(error.message),
    );
  });
});

describe("ObjectsService.links", () => {
  it("queries the link class by its key back to the parent", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 0));
    await service(fake).links("Server", 5, "softwares_list", { page: 1, limit: 20 });

    // id is emitted as a numeric literal, not a quoted string.
    assert.equal(fake.lastCall().params["key"], "SELECT SoftwareInstance WHERE system_id = 5");
    assert.equal(fake.lastCall().params["class"], "SoftwareInstance");
  });

  it("falls back to iTop's wildcard when the link class is outside the schema", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([], 0));
    await service(fake).links("Server", 5, "softwares_list", { page: 1, limit: 20 });
    // SoftwareInstance is not in the sample schema, mirroring the 27 lnk* and
    // Ticket/User classes missing from the real export.
    assert.equal(fake.lastCall().params["output_fields"], "*");
  });

  it("rejects an attribute that is not a relation", async () => {
    const fake = new FakeItopClient();
    await assert.rejects(
      () => service(fake).links("Server", 5, "name", { page: 1, limit: 20 }),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("404s on an unknown attribute", async () => {
    const fake = new FakeItopClient();
    await assert.rejects(
      () => service(fake).links("Server", 5, "nope", { page: 1, limit: 20 }),
      (error: unknown) => error instanceof AppError && error.status === 404,
    );
  });
});
