import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { AppError } from "../src/errors.js";
import { PACKAGE_ROOT } from "../src/config.js";
import { CmdbSchema } from "../src/schema/load.js";
import { sampleSchema } from "./helpers.js";

describe("CmdbSchema normalisation", () => {
  const schema = sampleSchema();

  it("re-categorises HierarchicalKey as a picker targeting its own class", () => {
    // extract-schema.py's ui_category() only special-cases ExternalField,
    // ExternalKey and LinkedSet*, so parent_id arrives tagged "scalar".
    const field = schema.require("Organization").fields["parent_id"];
    assert.equal(field?.ui, "picker");
    assert.equal(field?.widget, "picker");
    assert.equal(field?.target, "Organization");
    assert.equal(field?.normalized?.from, "scalar");
  });

  it("re-categorises Dashboard as ignored and keeps it out of writable", () => {
    const info = schema.require("Organization");
    assert.equal(info.fields["overview"]?.ui, "ignored");
    assert.ok(!info.writable.includes("overview"));
  });

  it("keeps a correctly tagged scalar untouched", () => {
    const field = schema.require("Organization").fields["name"];
    assert.equal(field?.ui, "scalar");
    assert.equal(field?.normalized, undefined);
  });

  it("flags a picker whose target class is missing from the export", () => {
    const field = schema.require("Server").fields["deliverymodel_id"];
    assert.equal(field?.ui, "picker");
    assert.equal(field?.targetAvailable, false);
    assert.ok(
      schema.diagnostics.some(
        (d) => d.class === "Server" && d.field === "deliverymodel_id",
      ),
    );
  });

  it("flags a related field whose link class is missing", () => {
    const field = schema.require("Server").fields["softwares_list"];
    assert.equal(field?.ui, "related");
    assert.equal(field?.linkedAvailable, false);
  });

  it("separates writable from readonly and related", () => {
    const info = schema.require("Server");
    assert.ok(info.writable.includes("name"));
    assert.ok(info.writable.includes("brand_id"), "pickers are writable");
    assert.ok(info.readonlyFields.includes("brand_name"), "ExternalFields are read-only");
    assert.ok(!info.writable.includes("brand_name"));
    assert.ok(info.relatedFields.includes("softwares_list"));
    assert.ok(!info.writable.includes("softwares_list"));
  });

  it("derives widgets from the iTop attribute type", () => {
    const fields = schema.require("Server").fields;
    assert.equal(fields["name"]?.widget, "text");
    assert.equal(fields["description"]?.widget, "textarea");
    assert.equal(fields["status"]?.widget, "select");
    assert.equal(fields["nb_u"]?.widget, "integer");
    assert.equal(fields["purchase_date"]?.widget, "date");
    assert.equal(fields["brand_name"]?.widget, "readonly");
    assert.equal(fields["softwares_list"]?.widget, "relation");
  });

  it("records the inheritance chain and immediate parent", () => {
    const info = schema.require("Server");
    assert.deepEqual(info.inherits, ["cmdbAbstractObject", "FunctionalCI", "PhysicalDevice"]);
    assert.equal(info.parent, "PhysicalDevice");
  });

  it("picks searchable string attributes, preferring name", () => {
    const info = schema.require("Server");
    assert.equal(info.searchable[0], "name");
    assert.ok(!info.searchable.includes("nb_u"), "integers are not text-searchable");
    assert.ok(!info.searchable.includes("brand_name"), "read-only fields are not searched");
  });

  it("throws a 404-shaped error for an unknown class", () => {
    assert.throws(
      () => schema.require("NoSuchClass"),
      (error: unknown) => error instanceof AppError && error.status === 404,
    );
  });

  it("separates CI classes from lookups", () => {
    assert.deepEqual(
      schema.ciClasses().map((c) => c.name),
      ["Server"],
    );
    assert.ok(schema.lookupClasses().some((c) => c.name === "Organization"));
  });
});

describe("CmdbSchema.fromFile", () => {
  it("rejects a missing file with an actionable message", () => {
    assert.throws(
      () => CmdbSchema.fromFile(resolve(PACKAGE_ROOT, "does-not-exist.json")),
      (error: unknown) =>
        error instanceof AppError && /extract-schema\.py/.test(error.message),
    );
  });
});

/**
 * Runs against the real compiled schema when it is present, which is what
 * actually proves the normalisation rules match the live datamodel rather than
 * just the fixture.
 */
describe("the real cmdb-schema.json", () => {
  const schemaPath = resolve(PACKAGE_ROOT, "../cmdb-schema/cmdb-schema.json");
  const available = existsSync(schemaPath);

  it("loads every class", { skip: available ? false : "cmdb-schema.json not generated" }, () => {
    const schema = CmdbSchema.fromFile(schemaPath);
    assert.ok(schema.classNames.length > 50, `expected >50 classes, got ${schema.classNames.length}`);
    assert.ok(schema.has("Server"));
    assert.ok(schema.has("Organization"));
  });

  it(
    "corrects the two HierarchicalKey attributes",
    { skip: available ? false : "cmdb-schema.json not generated" },
    () => {
      const schema = CmdbSchema.fromFile(schemaPath);
      for (const className of ["Organization", "Group"]) {
        const info = schema.get(className);
        if (!info?.fields["parent_id"]) continue;
        assert.equal(info.fields["parent_id"].ui, "picker", `${className}.parent_id`);
        assert.ok(!info.writable.includes("parent_name"));
      }
    },
  );

  it(
    "keeps Dashboard attributes out of every writable list",
    { skip: available ? false : "cmdb-schema.json not generated" },
    () => {
      const schema = CmdbSchema.fromFile(schemaPath);
      for (const info of schema.list()) {
        for (const [code, field] of Object.entries(info.fields)) {
          if (field.type === "Dashboard") {
            assert.ok(
              !info.writable.includes(code),
              `${info.name}.${code} is a Dashboard and must not be writable`,
            );
          }
        }
      }
    },
  );

  it(
    "never lists an ExternalField as writable",
    { skip: available ? false : "cmdb-schema.json not generated" },
    () => {
      const schema = CmdbSchema.fromFile(schemaPath);
      for (const info of schema.list()) {
        for (const code of info.writable) {
          assert.notEqual(
            info.fields[code]?.type,
            "ExternalField",
            `${info.name}.${code} is computed and must never be writable`,
          );
        }
      }
    },
  );
});
