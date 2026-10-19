import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CmdbSchema } from "../src/schema/load.js";
import { SAMPLE_RAW_SCHEMA } from "./helpers.js";

/**
 * iTop's form layout, list columns and wording, carried through the loader.
 *
 * Without these a generic screen has to invent a presentation: fields in
 * alphabetical order, attribute codes as labels, a guess at which columns
 * matter. iTop answers all of that per class, so the only question these
 * tests ask is whether the answer survives the trip.
 */

function schemaWith(overrides: Record<string, unknown>) {
  return CmdbSchema.fromRaw({
    ...SAMPLE_RAW_SCHEMA,
    Server: { ...SAMPLE_RAW_SCHEMA["Server"]!, ...overrides },
  } as never);
}

describe("presentation", () => {
  it("carries iTop's layout through to the class info", () => {
    const schema = schemaWith({
      presentation: {
        columns: [
          {
            id: "col:col1",
            fieldsets: [
              { id: "fieldset:Server:baseinfo", label: "General", fields: ["name", "status"] },
            ],
          },
        ],
        list: ["name", "status"],
        related: [],
      },
    });

    const info = schema.require("Server");
    assert.equal(info.presentation?.columns[0]?.fieldsets[0]?.label, "General");
    assert.deepEqual(info.presentation?.list, ["name", "status"]);
  });

  it("reports no layout rather than a fake one", () => {
    // 11 of the 158 classes declare nothing. A consumer has to be able to tell
    // "iTop says nothing" from "iTop says show no fields", because the first
    // means fall back and the second means render an empty form.
    const info = schemaWith({}).require("Server");

    assert.equal(info.presentation, null);
  });

  it("always exposes labels, even for a class that has none", () => {
    // Defaulted so `labels.fields[code]` is safe to read everywhere, rather
    // than forcing a null check at every call site.
    const info = schemaWith({}).require("Server");

    assert.equal(info.labels.class, "Server");
    assert.deepEqual(info.labels.fields, {});
    assert.deepEqual(info.labels.values, {});
  });

  it("keeps iTop's wording for fields and enum values", () => {
    const info = schemaWith({
      labels: {
        class: "Server",
        fields: { nb_u: "Number of U" },
        values: { status: { production: "Production" } },
      },
    }).require("Server");

    assert.equal(info.labels.fields["nb_u"], "Number of U");
    assert.equal(info.labels.values["status"]?.["production"], "Production");
  });

  it("defaults stimuli to an empty list on a lifecycle class", () => {
    // The detail screen maps over `lifecycle.stimuli`. Undefined there would
    // throw on any class whose export predates the stimuli field.
    const schema = CmdbSchema.fromRaw({
      ...SAMPLE_RAW_SCHEMA,
      Server: {
        ...SAMPLE_RAW_SCHEMA["Server"]!,
        lifecycle: { attribute: "status", states: { production: [] } },
      },
    } as never);

    assert.deepEqual(schema.require("Server").lifecycle?.stimuli, []);
  });

  it("carries stimuli when iTop declares them", () => {
    const schema = CmdbSchema.fromRaw({
      ...SAMPLE_RAW_SCHEMA,
      Server: {
        ...SAMPLE_RAW_SCHEMA["Server"]!,
        lifecycle: {
          attribute: "status",
          states: { production: ["retire"] },
          stimuli: ["retire"],
        },
      },
    } as never);

    assert.deepEqual(schema.require("Server").lifecycle?.stimuli, ["retire"]);
  });
});
