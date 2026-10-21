import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAs, type Caller } from "../src/core/request-context.js";
import { CurrentContact } from "../src/shared/current-contact.js";
import { DefaultOrganization } from "../src/shared/default-organization.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import { FakeItopClient, getResponse, SAMPLE_RAW_SCHEMA } from "./helpers.js";

const schema = CmdbSchema.fromRaw({
  ...SAMPLE_RAW_SCHEMA,
  Person: {
    is_ci: false,
    abstract: false,
    inherits: ["cmdbAbstractObject", "Contact"],
    lifecycle: null,
    writable: ["name", "org_id"],
    readonly: [],
    fields: {
      name: { type: "String", ui: "scalar", owner: "Contact", required: true },
      org_id: { type: "ExternalKey", ui: "picker", owner: "Contact", target: "Organization" },
    },
  },
});

/**
 * The service account's own organisation must win over the single-org rule.
 * It used to be looked up through ObjectsService("UserLocal"), which the
 * published schema refuses, so the rule silently never applied.
 */
describe("DefaultOrganization", () => {
  function build(fake: FakeItopClient) {
    const objects = new ObjectsService(fake.asClient(), schema, "test");
    const contact = new CurrentContact(fake.asClient(), "svc");
    return new DefaultOrganization(objects, contact);
  }

  it("uses the organisation of the account's linked person", async () => {
    const fake = new FakeItopClient().on("core/get", [
      // User lookup -> contact 42
      getResponse([{ class: "UserLocal", id: 1, fields: { contactid: "42" } }]),
      // Person 42 -> org 7
      getResponse([{ class: "Person", id: 42, fields: { org_id: "7" } }]),
    ]);

    assert.equal(await build(fake).resolve(), "7");
    // Looked up polymorphically, so LDAP and external accounts are found too.
    assert.equal(fake.calls[0]?.params["class"], "User");
    assert.match(String(fake.calls[0]?.params["key"]), /^SELECT User WHERE login = 'svc'$/);
  });

  it("falls back to the only organisation when the account has no contact", async () => {
    const fake = new FakeItopClient().on("core/get", [
      getResponse([{ class: "UserLocal", id: 1, fields: { contactid: "0" } }]),
      getResponse([{ class: "Organization", id: 3, fields: { name: "Acme" } }], 1),
    ]);
    assert.equal(await build(fake).resolve(), "3");
  });

  it("works out the default as the service account for a user without an organisation", async () => {
    // Worked out as Ann, it would follow her contact (99) and be cached for
    // everyone after her.
    const ann: Caller = {
      userId: 5, login: "ann", contactId: 99, name: "Ann", email: "", kind: "staff", profiles: [],
      isAdmin: false, allowedOrgIds: [], orgId: 0, credentials: { user: "ann", password: "pw" },
    };
    const fake = new FakeItopClient().on("core/get", [
      getResponse([{ class: "UserLocal", id: 1, fields: { contactid: "42" } }]),
      getResponse([{ class: "Person", id: 42, fields: { org_id: "7" } }]),
    ]);
    assert.equal(await runAs(ann, () => build(fake).resolve()), "7");
    assert.ok(fake.calls.every((c) => c.as === "service"));
    assert.match(String(fake.calls[1]?.params["key"]), /id = 42/);
  });
});
