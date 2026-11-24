import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { publicText, setPublicName } from "../src/core/public-text.js";
import { agreementFor, DEFAULT_NAMES } from "../src/platform/licensing/eula.js";

/**
 * The product's name is a setting (docs/deployment.md, "The product's name"):
 * one build runs as Intertec and as IRAOPS. Unset, every text stays word for
 * word what it was.
 */
const IRAOPS = { product: "IRAOPS", company: "IRAOPS" };

describe("product names in the agreements", () => {
  it("leaves both agreements exactly as they are by default", () => {
    for (const saas of [false, true]) {
      const a = agreementFor(saas);
      assert.equal(agreementFor(saas, DEFAULT_NAMES), a);
      assert.match(a.text, /^ARCUS /);
      assert.match(a.text, /the Intertec company named in your order/);
    }
  });

  it("names IRAOPS, and neither Arcus nor Intertec, when set", () => {
    for (const saas of [false, true]) {
      const plain = agreementFor(saas);
      const a = agreementFor(saas, IRAOPS);
      assert.equal(a.version, plain.version, "same text version: an acceptance is per version");
      assert.match(a.text, /^IRAOPS (END-USER LICENCE AGREEMENT|TERMS OF SERVICE)/);
      assert.match(a.text, /between the IRAOPS company named in your order \(“IRAOPS”, “we”, “us”\)/);
      assert.doesNotMatch(a.text, /Arcus|ARCUS|Intertec/);
    }
  });
});

describe("what messages call the system of record", () => {
  afterEach(() => setPublicName("Servicedesk"));

  it("is Servicedesk by default", () => {
    assert.equal(publicText("iTop refused the change."), "Servicedesk refused the change.");
  });

  it("is PUBLIC_NAME when set", () => {
    setPublicName("IRAOPS");
    assert.equal(publicText("This iTop is read-only; iTop said no."), "IRAOPS is read-only; IRAOPS said no.");
  });
});
