import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cleanMessage,
  normalizeObjectSets,
  normalizeObjects,
  parseFoundCount,
} from "../src/itop/normalize.js";

describe("normalizeObjects", () => {
  it("flattens the normal Class::id keyed map", () => {
    const flat = normalizeObjects({
      "Server::12": {
        code: 0,
        message: "",
        class: "Server",
        key: "12",
        fields: { name: "srv-01" },
      },
    });
    assert.deepEqual(flat, [
      { class: "Server", id: 12, code: 0, message: "", fields: { name: "srv-01" } },
    ]);
  });

  it("returns an empty array when objects is null", () => {
    // PHP leaves RestResultWithObjects::$objects uninitialised, so a query that
    // matches nothing serialises as null rather than {}.
    assert.deepEqual(normalizeObjects(null), []);
    assert.deepEqual(normalizeObjects(undefined), []);
  });

  it("flattens the array-of-aliases shape used for multi-class results", () => {
    // RestResultWithObjectSets::AppendSubObject produces this for a JOIN.
    const flat = normalizeObjects([
      {
        s: { code: 0, message: "", class: "Server", key: "1", fields: { name: "a" } },
        o: { code: 0, message: "", class: "Organization", key: "7", fields: { name: "Acme" } },
      },
    ]);
    assert.equal(flat.length, 2);
    assert.deepEqual(
      flat.map((f) => [f.alias, f.class, f.id]),
      [
        ["s", "Server", 1],
        ["o", "Organization", 7],
      ],
    );
  });

  it("parses the string primary key into a number", () => {
    const [first] = normalizeObjects({
      "Server::99": { code: 0, message: "", class: "Server", key: "99", fields: {} },
    });
    assert.equal(first?.id, 99);
    assert.equal(typeof first?.id, "number");
  });

  it("skips entries that are not object results", () => {
    const flat = normalizeObjects({
      ok: { code: 0, message: "", class: "Server", key: "1", fields: {} },
      junk: null as never,
    });
    assert.equal(flat.length, 1);
  });

  it("defaults a missing fields map rather than throwing", () => {
    const [first] = normalizeObjects({
      "Server::1": { code: 0, message: "", class: "Server", key: "1" } as never,
    });
    assert.deepEqual(first?.fields, {});
  });
});

describe("normalizeObjectSets", () => {
  it("preserves row grouping for a JOIN", () => {
    const rows = normalizeObjectSets([
      {
        s: { code: 0, message: "", class: "Server", key: "1", fields: {} },
        o: { code: 0, message: "", class: "Organization", key: "7", fields: {} },
      },
      {
        s: { code: 0, message: "", class: "Server", key: "2", fields: {} },
        o: { code: 0, message: "", class: "Organization", key: "7", fields: {} },
      },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.["s"]?.id, 1);
    assert.equal(rows[1]?.["s"]?.id, 2);
  });

  it("treats each object as its own row for a single-class result", () => {
    const rows = normalizeObjectSets({
      "Server::1": { code: 0, message: "", class: "Server", key: "1", fields: {} },
      "Server::2": { code: 0, message: "", class: "Server", key: "2", fields: {} },
    });
    assert.equal(rows.length, 2);
  });
});

describe("parseFoundCount", () => {
  it("reads the total out of the message", () => {
    // DBObjectSet::Count() queries with limit 0, so this is the total across all
    // pages, not the size of the page returned.
    assert.equal(parseFoundCount("Found: 1234"), 1234);
  });

  it("handles zero", () => {
    assert.equal(parseFoundCount("Found: 0"), 0);
  });

  it("returns null when there is no count to read", () => {
    assert.equal(parseFoundCount("Nothing found"), null);
    assert.equal(parseFoundCount(""), null);
    assert.equal(parseFoundCount(null), null);
    assert.equal(parseFoundCount(undefined), null);
  });

  it("does not confuse the get_related message for a count", () => {
    assert.equal(parseFoundCount("Scope: 1; Related objects: Server= 3, PC= 2"), null);
  });
});

describe("cleanMessage", () => {
  it("strips the Error: prefix rest.php adds", () => {
    assert.equal(cleanMessage("Error: Invalid object Server::9"), "Invalid object Server::9");
  });

  it("leaves other messages alone", () => {
    assert.equal(cleanMessage("Found: 3"), "Found: 3");
  });

  it("handles null", () => {
    assert.equal(cleanMessage(null), "");
  });
});
