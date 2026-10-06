import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/core/errors.js";
import { validateWrite } from "../src/shared/write-validation.js";
import { sampleSchema } from "./helpers.js";

const schema = sampleSchema();
const server = schema.require("Server");
const organization = schema.require("Organization");

describe("validateWrite", () => {
  it("accepts writable scalars and pickers", () => {
    const { fields } = validateWrite(
      server,
      { name: "srv-01", status: "production", org_id: 3 },
      { mode: "update" },
    );
    assert.deepEqual(fields, { name: "srv-01", status: "production", org_id: 3 });
  });

  it("refuses an ExternalField, naming the key to set instead", () => {
    // Server.brand_name is resolved by iTop through brand_id; sending it back is
    // the single easiest way to corrupt a write.
    assert.throws(
      () => validateWrite(server, { brand_name: "Dell" }, { mode: "update" }),
      (error: unknown) =>
        error instanceof AppError &&
        error.status === 400 &&
        /brand_id/.test(error.message),
    );
  });

  it("refuses a link set", () => {
    assert.throws(
      () => validateWrite(server, { softwares_list: [] }, { mode: "update" }),
      (error: unknown) => error instanceof AppError && /relation/.test(error.message),
    );
  });

  it("refuses a Dashboard attribute", () => {
    assert.throws(
      () => validateWrite(organization, { overview: "x" }, { mode: "update" }),
      (error: unknown) => error instanceof AppError && error.status === 400,
    );
  });

  it("refuses an unknown attribute", () => {
    assert.throws(
      () => validateWrite(server, { nope: 1 }, { mode: "update" }),
      (error: unknown) => error instanceof AppError && /no such attribute/.test(error.message),
    );
  });

  it("refuses id and friendlyname, which iTop assigns", () => {
    assert.throws(() => validateWrite(server, { id: 5 }, { mode: "update" }), AppError);
    assert.throws(
      () => validateWrite(server, { friendlyname: "x" }, { mode: "update" }),
      AppError,
    );
  });

  it("drops rather than rejects unwritable fields when strict is false", () => {
    // Lets a frontend PATCH back an object it fetched with read-only fields
    // included, without having to strip them itself.
    const { fields, rejected } = validateWrite(
      server,
      { name: "srv-01", brand_name: "Dell", softwares_list: [], id: 9 },
      { mode: "update", strict: false },
    );
    assert.deepEqual(fields, { name: "srv-01" });
    assert.deepEqual(rejected.map((r) => r.field).sort(), ["brand_name", "id", "softwares_list"]);
  });

  it("enforces required attributes on create", () => {
    assert.throws(
      () => validateWrite(server, { name: "srv-01" }, { mode: "create" }),
      (error: unknown) =>
        error instanceof AppError && /org_id/.test(error.message),
    );
  });

  it("does not enforce required attributes on update", () => {
    const { fields } = validateWrite(server, { name: "srv-01" }, { mode: "update" });
    assert.deepEqual(fields, { name: "srv-01" });
  });

  it("treats an empty string as missing for a required attribute", () => {
    assert.throws(
      () => validateWrite(server, { name: "", org_id: 3 }, { mode: "create" }),
      (error: unknown) => error instanceof AppError && /name/.test(error.message),
    );
  });

  it("rejects a value outside an enum", () => {
    assert.throws(
      () => validateWrite(server, { status: "retired" }, { mode: "update" }),
      (error: unknown) =>
        error instanceof AppError && /production/.test(JSON.stringify(error.details)),
    );
  });

  it("accepts every declared enum value", () => {
    for (const status of ["production", "implementation", "stock", "obsolete"]) {
      const { fields } = validateWrite(server, { status }, { mode: "update" });
      assert.equal(fields["status"], status);
    }
  });

  it("coerces a numeric string picker id to a number", () => {
    const { fields } = validateWrite(server, { org_id: "42" }, { mode: "update" });
    assert.equal(fields["org_id"], 42);
  });

  it("treats an empty picker value as 0, which clears the key in iTop", () => {
    const { fields } = validateWrite(server, { brand_id: "" }, { mode: "update" });
    assert.equal(fields["brand_id"], 0);
  });

  it("passes a non-numeric picker value through for iTop to resolve", () => {
    // RestUtils::MakeValue accepts an OQL string or a criteria object here.
    const { fields } = validateWrite(server, { brand_id: "SELECT Brand WHERE name='Dell'" }, { mode: "update" });
    assert.equal(fields["brand_id"], "SELECT Brand WHERE name='Dell'");
  });

  it("rejects a negative picker id", () => {
    assert.throws(() => validateWrite(server, { org_id: -1 }, { mode: "update" }), AppError);
  });

  it("coerces and validates integers", () => {
    assert.equal(validateWrite(server, { nb_u: "4" }, { mode: "update" }).fields["nb_u"], 4);
    assert.throws(() => validateWrite(server, { nb_u: 1.5 }, { mode: "update" }), AppError);
    assert.throws(() => validateWrite(server, { nb_u: "many" }, { mode: "update" }), AppError);
  });

  it("requires YYYY-MM-DD for a Date attribute", () => {
    assert.equal(
      validateWrite(server, { purchase_date: "2026-01-31" }, { mode: "update" }).fields[
        "purchase_date"
      ],
      "2026-01-31",
    );
    assert.throws(
      () => validateWrite(server, { purchase_date: "31/01/2026" }, { mode: "update" }),
      AppError,
    );
  });

  it("allows an empty date to clear the value", () => {
    assert.equal(
      validateWrite(server, { purchase_date: "" }, { mode: "update" }).fields["purchase_date"],
      "",
    );
  });

  it("passes null through", () => {
    assert.equal(
      validateWrite(server, { purchase_date: null }, { mode: "update" }).fields["purchase_date"],
      null,
    );
  });

  it("rejects a non-object payload", () => {
    for (const bad of [null, "x", 5, []]) {
      assert.throws(() => validateWrite(server, bad, { mode: "update" }), AppError);
    }
  });

  it("rejects a payload with nothing writable in it", () => {
    assert.throws(() => validateWrite(server, {}, { mode: "update" }), AppError);
  });
});
