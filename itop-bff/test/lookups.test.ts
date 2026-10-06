import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/errors.js";
import { LookupsService, translateFilter } from "../src/services/lookups.js";
import { FakeItopClient, getResponse, sampleSchema } from "./helpers.js";

const schema = sampleSchema();

function service(fake: FakeItopClient, ttlMs = 0): LookupsService {
  return new LookupsService(fake.asClient(), schema, ttlMs);
}

describe("translateFilter", () => {
  const server = schema.require("Server");
  const model = schema.require("Model");
  const brand = schema.require("Brand");

  it("translates a single :this-> equality when the value is supplied", () => {
    // Server.model_id -> "SELECT Model WHERE brand_id=:this->brand_id"
    const result = translateFilter(server.fields["model_id"]!, model, { brand_id: "7" });
    assert.deepEqual(result.equals, { brand_id: 7 });
    assert.equal(result.ignored, false);
  });

  it("reports ignored when the dependency is not supplied", () => {
    const result = translateFilter(server.fields["model_id"]!, model, {});
    assert.deepEqual(result.equals, {});
    assert.equal(result.ignored, true);
    // The UI needs to know which attribute to collect first.
    assert.ok(result.contextFields.includes("brand_id"));
  });

  it("reports ignored when the dependency is blank", () => {
    const result = translateFilter(server.fields["model_id"]!, model, { brand_id: "" });
    assert.equal(result.ignored, true);
  });

  it("refuses to translate a JOIN filter rather than mistranslating it", () => {
    // Server.location_id joins Organization twice with a BELOW clause; getting
    // that wrong would silently show the wrong locations.
    const result = translateFilter(server.fields["location_id"]!, schema.require("Organization"), {
      org_id: "3",
    });
    assert.equal(result.ignored, true);
    assert.deepEqual(result.equals, {});
  });

  it("returns nothing to do when the field has no filter", () => {
    const result = translateFilter(server.fields["brand_id"]!, brand, {});
    assert.deepEqual(result.equals, {});
    assert.equal(result.ignored, false);
  });

  it("keeps a literal right-hand side", () => {
    const result = translateFilter(
      { ...model.fields["brand_id"]!, filter: "SELECT Model WHERE name='Dell'" },
      model,
      {},
    );
    assert.deepEqual(result.equals, { name: "Dell" });
  });

  it("ignores a condition on an attribute the schema does not know", () => {
    const result = translateFilter(
      { ...server.fields["model_id"]!, filter: "SELECT Model WHERE mystery=:this->brand_id" },
      model,
      { brand_id: "1" },
    );
    assert.equal(result.ignored, true);
  });

  it("ignores :this->finalclass, which has no form value", () => {
    const result = translateFilter(
      {
        ...server.fields["model_id"]!,
        filter: "SELECT Model WHERE brand_id=:this->brand_id AND name=:this->finalclass",
      },
      model,
      { brand_id: "7" },
    );
    assert.deepEqual(result.equals, { brand_id: 7 });
    assert.equal(result.ignored, true);
  });
});

describe("LookupsService.forField", () => {
  it("applies the translated filter to the OQL", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Model", id: 2, fields: { friendlyname: "PowerEdge" } }]),
    );

    const result = await service(fake).forField("Server", "model_id", {
      context: { brand_id: "7" },
    });

    assert.equal(fake.lastCall().params["key"], "SELECT Model WHERE brand_id = 7");
    assert.deepEqual(result.options, [{ id: 2, label: "PowerEdge" }]);
    assert.deepEqual(result.dependsOn, ["brand_id"]);
    assert.equal(result.filterIgnored, undefined);
  });

  it("flags filterIgnored so the UI can keep the dropdown disabled", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const result = await service(fake).forField("Server", "model_id", {});
    assert.equal(result.filterIgnored, true);
    assert.equal(fake.lastCall().params["key"], "SELECT Model");
  });

  it("refuses a picker whose target is missing from the schema", async () => {
    const fake = new FakeItopClient();
    await assert.rejects(
      () => service(fake).forField("Server", "deliverymodel_id", {}),
      (error: unknown) =>
        error instanceof AppError && /LOOKUP_CLASSES/.test(error.message),
    );
  });

  it("refuses a non-picker attribute", async () => {
    const fake = new FakeItopClient();
    await assert.rejects(
      () => service(fake).forField("Server", "name", {}),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("reports truncation when more options exist than were returned", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Brand", id: 1, fields: { friendlyname: "Dell" } }], 250),
    );
    const result = await service(fake).forField("Server", "brand_id", { limit: 1 });
    assert.equal(result.total, 250);
    assert.equal(result.truncated, true);
  });
});

describe("LookupsService.forClass", () => {
  it("searches by term across searchable attributes", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    await service(fake).forClass("Organization", { q: "acme" });
    assert.equal(fake.lastCall().params["key"], "SELECT Organization WHERE (name LIKE '%acme%')");
  });

  it("caches repeated identical queries", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Brand", id: 1, fields: { friendlyname: "Dell" } }]),
    );
    const svc = service(fake, 60_000);

    await svc.forClass("Brand");
    await svc.forClass("Brand");

    assert.equal(fake.calls.length, 1, "second call served from cache");
  });

  it("does not cache when the TTL is zero", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));
    const svc = service(fake, 0);
    await svc.forClass("Brand");
    await svc.forClass("Brand");
    assert.equal(fake.calls.length, 2);
  });

  it("returns a copy, so a caller cannot mutate the cache", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Brand", id: 1, fields: { friendlyname: "Dell" } }]),
    );
    const svc = service(fake, 60_000);

    const first = await svc.forClass("Brand");
    first.options.push({ id: 999, label: "injected" });
    const second = await svc.forClass("Brand");

    assert.equal(second.options.length, 1);
  });

  it("labels an option from name when friendlyname is absent", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([{ class: "Brand", id: 4, fields: { name: "HP" } }]),
    );
    const result = await service(fake).forClass("Brand");
    assert.equal(result.options[0]?.label, "HP");
  });
});
