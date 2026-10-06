import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/errors.js";
import { assertIdentifier, buildOql, quoteString } from "../src/itop/oql.js";

describe("quoteString", () => {
  it("wraps a plain value in single quotes", () => {
    assert.equal(quoteString("srv-01"), "'srv-01'");
  });

  it("escapes apostrophes so they cannot close the literal", () => {
    assert.equal(quoteString("O'Brien"), "'O\\'Brien'");
  });

  it("escapes backslashes before apostrophes", () => {
    // A lone trailing backslash must not escape the closing quote.
    assert.equal(quoteString("DOMAIN\\"), "'DOMAIN\\\\'");
  });

  it("neutralises an OQL injection attempt", () => {
    const injected = quoteString("' OR 1=1 OR name LIKE '%");
    // Every apostrophe is escaped, so the whole payload stays one literal.
    assert.equal(injected, "'\\' OR 1=1 OR name LIKE \\'%'");
    assert.equal(countUnescapedQuotes(injected), 2, "only the delimiters are unescaped");
  });

  it("survives the backslash-apostrophe pair that defeats naive escapers", () => {
    // A naive escaper that only replaced ' would emit ...\\' and let the
    // backslash escape the apostrophe, re-opening the literal.
    const quoted = quoteString("a\\'b");
    assert.equal(quoted, "'a\\\\\\'b'");
    assert.equal(countUnescapedQuotes(quoted), 2);
  });

  it("rejects NUL bytes", () => {
    assert.throws(() => quoteString("bad\0value"), AppError);
  });
});

/**
 * Walks the string the way iTop's lexer does, counting apostrophes that are not
 * preceded by an escaping backslash. A correctly escaped literal has exactly
 * two: the opening and closing delimiters.
 */
function countUnescapedQuotes(oqlLiteral: string): number {
  let count = 0;
  let index = 0;
  while (index < oqlLiteral.length) {
    const char = oqlLiteral[index];
    if (char === "\\") {
      index += 2; // the lexer consumes \\ and \' as single units
      continue;
    }
    if (char === "'") count += 1;
    index += 1;
  }
  return count;
}

describe("assertIdentifier", () => {
  it("accepts iTop attribute codes", () => {
    assert.equal(assertIdentifier("org_id", "attribute code"), "org_id");
    assert.equal(assertIdentifier("_private2", "attribute code"), "_private2");
  });

  for (const bad of ["1name", "org id", "org-id", "name;DROP", "", "név"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => assertIdentifier(bad, "attribute code"), AppError);
    });
  }
});

describe("buildOql", () => {
  it("builds a bare select when there are no conditions", () => {
    assert.equal(buildOql({ class: "Server" }), "SELECT Server");
  });

  it("ANDs equality conditions", () => {
    const oql = buildOql({ class: "Server", equals: { status: "production", org_id: 3 } });
    assert.equal(oql, "SELECT Server WHERE status = 'production' AND org_id = 3");
  });

  it("uses IS NULL rather than = NULL", () => {
    assert.equal(buildOql({ class: "Server", equals: { model_id: null } }), "SELECT Server WHERE model_id IS NULL");
  });

  it("ORs a search term across searchable attributes", () => {
    const oql = buildOql({
      class: "Server",
      search: { term: "web", attributes: ["name", "description"] },
    });
    assert.equal(
      oql,
      "SELECT Server WHERE (name LIKE '%web%' OR description LIKE '%web%')",
    );
  });

  it("escapes LIKE wildcards so a literal % does not match everything", () => {
    const oql = buildOql({ class: "Server", search: { term: "50%", attributes: ["name"] } });
    // The % the user typed is backslash-escaped for MySQL's LIKE; the
    // surrounding %s stay live.
    assert.equal(oql, "SELECT Server WHERE (name LIKE '%50\\\\%%')");
  });

  it("escapes underscores, which LIKE treats as a single-character wildcard", () => {
    const oql = buildOql({ class: "Server", search: { term: "a_b", attributes: ["name"] } });
    assert.equal(oql, "SELECT Server WHERE (name LIKE '%a\\\\_b%')");
  });

  it("keeps an injected search term inside the literal", () => {
    const oql = buildOql({
      class: "Server",
      search: { term: "' OR 1=1 --", attributes: ["name"] },
    });
    assert.equal(countUnescapedQuotes(oql.slice(oql.indexOf("'"))), 2);
  });

  it("rejects an invalid class name", () => {
    assert.throws(() => buildOql({ class: "Server; DROP" }), AppError);
  });

  it("rejects an invalid attribute code in a filter", () => {
    assert.throws(() => buildOql({ class: "Server", equals: { "a b": 1 } }), AppError);
  });

  it("rejects a non-finite number", () => {
    assert.throws(() => buildOql({ class: "Server", equals: { nb_u: Number.NaN } }), AppError);
  });

  it("requires at least one searchable attribute", () => {
    assert.throws(
      () => buildOql({ class: "Server", search: { term: "x", attributes: [] } }),
      AppError,
    );
  });

  it("ignores a blank search term", () => {
    assert.equal(
      buildOql({ class: "Server", search: { term: "   ", attributes: ["name"] } }),
      "SELECT Server",
    );
  });

  it("never emits ORDER BY, which iTop's OQL grammar does not support", () => {
    const oql = buildOql({
      class: "Server",
      equals: { status: "production" },
      search: { term: "db", attributes: ["name"] },
    });
    assert.ok(!/ORDER\s+BY/i.test(oql));
  });
});
