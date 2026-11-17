import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renewals } from "../src/platform/licensing/issuer/desk.js";
import type { RegisterEntry } from "../src/platform/licensing/issuer/register.store.js";
import type { IssueLicenceResult, LicencesOverview, LicenceStatus } from "../src/platform/licensing/index.js";
import { verifyArcusLicence } from "../src/platform/licensing/licence.verify.js";
import { code, licenceApp } from "./licence-app.js";

/** The platform's own address: no tenant claims it. */
const PLATFORM = "platform.test";

const order = {
  customer: "Beta Ltd",
  orderRef: "SO-9001",
  type: "subscription",
  termYears: 1,
  edition: "PRO",
  deployment: "saas",
  binding: "tenant:beta",
  agents: 25,
  validFrom: "2026-12-01",
};
const newTenant = { id: "beta", name: "Beta Ltd", domains: ["beta.test"], orgIds: [30] };

describe("the licence desk (operator Licences page)", () => {
  it("is for platform operators on the platform's own address only", async () => {
    const t = await licenceApp({ tenancy: true });
    assert.equal((await t.send("GET", "/api/platform/licences", t.users.operator, undefined, PLATFORM)).statusCode, 200);
    assert.equal(code(await t.send("GET", "/api/platform/licences", t.users.admin, undefined, PLATFORM)), "forbidden");
    assert.equal(code(await t.send("GET", "/api/platform/licences", t.users.operator)), "forbidden", "not on a customer's site");
    const status = (await t.send("GET", "/api/licence/status", t.users.operator, undefined, PLATFORM)).json() as LicenceStatus;
    assert.equal(status.operator, true);
  });

  it("creates a SaaS customer's tenant and issues and installs its licence in one step", async () => {
    const t = await licenceApp({ tenancy: true });
    const res = await t.send("POST", "/api/platform/licences", t.users.operator, { ...order, newTenant }, PLATFORM);
    assert.equal(res.statusCode, 201, res.body);
    const r = res.json() as IssueLicenceResult;
    assert.deepEqual([r.tenantCreated, r.installed, r.licence.licenceId, r.licence.status], [true, true, "ARC-2026-000001", "current"]);
    assert.ok((await t.services.tenantStore.list()).some((x) => x.id === "beta" && x.status === "active"));
    const verified = verifyArcusLicence(r.text, { allowDevKey: true, devPublicKeyPem: t.licensing.settings.keys.devPublicKeyPem! });
    assert.equal(verified.ok && verified.licence.binding, "tenant:beta");
    const beta = await t.licensing.statusOf("beta");
    assert.deepEqual([beta.state, beta.licence?.entitlements.named_seats], ["valid", 25]);
    // The register lists it, and a second customer with the same id is refused.
    const overview = (await t.send("GET", "/api/platform/licences", t.users.operator, undefined, PLATFORM)).json() as LicencesOverview;
    assert.deepEqual([overview.canIssue, overview.licences.map((l) => l.licenceId)], [true, ["ARC-2026-000001"]]);
    assert.equal(code(await t.send("POST", "/api/platform/licences", t.users.operator, { ...order, newTenant }, PLATFORM)), "conflict");
  });

  it("creates nothing when the order is refused", async () => {
    const t = await licenceApp({ tenancy: true });
    const bad = await t.send("POST", "/api/platform/licences", t.users.operator, { ...order, termYears: 2, newTenant }, PLATFORM);
    assert.equal(code(bad), "bad_request");
    assert.ok(!(await t.services.tenantStore.list()).some((x) => x.id === "beta"));
    assert.deepEqual((await t.services.licenceDesk!.register.list()).length, 0);
  });

  it("re-issues an upgrade with the same end date, installs it, and marks the old one replaced", async () => {
    const t = await licenceApp({ tenancy: true });
    await t.send("POST", "/api/platform/licences", t.users.operator, { ...order, binding: "tenant:acme" }, PLATFORM);
    const up = await t.send("POST", "/api/platform/licences/ARC-2026-000001/reissue", t.users.operator, { reason: "upgrade", edition: "ENT", agents: 40 }, PLATFORM);
    assert.equal(up.statusCode, 201, up.body);
    const r = up.json() as IssueLicenceResult;
    assert.deepEqual([r.licence.licenceId, r.licence.edition, r.licence.expiresAt, r.licence.replaces, r.installed], ["ARC-2026-000002", "ENT", "2027-11-30", "ARC-2026-000001", true]);
    assert.equal((await t.status(t.users.admin)).edition, "ENT");
    const old = (await t.services.licenceDesk!.register.get("ARC-2026-000001"))!;
    assert.equal(old.replacedBy, "ARC-2026-000002");
  });

  it("SaaS revocation takes effect at once: the tenant goes to evaluation mode", async () => {
    const t = await licenceApp({ tenancy: true });
    await t.send("POST", "/api/platform/licences", t.users.operator, { ...order, binding: "tenant:acme" }, PLATFORM);
    assert.equal((await t.status(t.users.admin)).state, "valid");
    const res = await t.send("POST", "/api/platform/licences/ARC-2026-000001/revoke", t.users.operator, { reason: "contract ended" }, PLATFORM);
    assert.equal(res.statusCode, 200, res.body);
    const s = await t.status(t.users.admin);
    assert.equal(s.state, "evaluation_mode");
    assert.match(s.banners.map((b) => b.message).join(" "), /has been revoked/);
    assert.equal(code(await t.write()), "LICENCE_READ_ONLY");
  });

  it("without a signer on this server, issuing says to use the CLI", async () => {
    const t = await licenceApp({ tenancy: true, noSigner: true });
    const overview = (await t.send("GET", "/api/platform/licences", t.users.operator, undefined, PLATFORM)).json() as LicencesOverview;
    assert.equal(overview.canIssue, false);
    const res = await t.send("POST", "/api/platform/licences", t.users.operator, order, PLATFORM);
    assert.equal(code(res), "conflict");
    assert.match((res.json() as { error: { message: string } }).error.message, /CLI/);
  });

  it("lists renewals due within 30, 60 and 90 days (SAS-03)", () => {
    const e = (id: string, expiresAt: string | null, extra: Partial<RegisterEntry> = {}) => ({ licenceId: id, expiresAt, revokedAt: null, replacedBy: null, ...extra }) as RegisterEntry;
    const due = renewals(
      [
        e("A", "2026-12-10"),
        e("B", "2027-01-10"),
        e("C", "2027-02-10"),
        e("D", "2027-06-01"),
        e("E", "2026-12-05", { revokedAt: "2026-11-01" }),
        e("F", "2026-12-05", { replacedBy: "G" }),
        e("P", null),
      ],
      "2026-11-17",
    );
    assert.deepEqual([due.within30.map((x) => x.licenceId), due.within60.map((x) => x.licenceId), due.within90.map((x) => x.licenceId)], [["A"], ["B"], ["C"]]);
  });
});
