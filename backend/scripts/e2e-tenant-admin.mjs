/**
 * A customer's own administration, branding, email domains, self-registration
 * and the language preference, against a running BFF and the local iTop
 * (TENANCY=on, SELF_REGISTRATION=on, MFA_REQUIRED=off for scripted sign-in).
 *
 * Uses the test tenants of `npm run tenants -- seed-test` (mt-acme on
 * acme.localhost, mt-globex on globex.localhost). Proves an administrator of
 * one tenant manages only their own, cannot grant Administrator, cannot use
 * another tenant's organisation, and that branding is served by host name.
 * With a Mailpit (MAILPIT, default http://127.0.0.1:8025) and SMTP pointed at
 * it, also registers a new end user and finds the set-password mail.
 *
 *   E2E_BFF=http://127.0.0.1:4080 npm run e2e:tenant-admin
 *
 * What it writes is named zz-e2e-… and removed again, except the
 * self-registered person and account (iTop keeps accounts; disabled at the end).
 */
import http from "node:http";

const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4080");
const MAILPIT = process.env.MAILPIT ?? "http://127.0.0.1:8025";
const PASSWORD = process.env.MT_TEST_PASSWORD ?? "Tenancy-Test-2026!";
const ACME = { id: "mt-acme", host: "acme.localhost", admin: "mt.acme.admin" };
const GLOBEX = { id: "mt-globex", host: "globex.localhost", admin: "mt.globex.admin" };
const STAMP = Date.now().toString(36);

let passed = 0;
const failures = [];

function request(method, path, { host = "app.localhost", cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        method,
        hostname: BFF.hostname,
        port: BFF.port,
        path,
        headers: {
          host: `${host}:${BFF.port}`,
          origin: `http://${host}:${BFF.port}`,
          ...(cookie ? { cookie } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, json, headers: res.headers, text });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error(`${method} ${path} timed out`)));
    if (payload) req.write(payload);
    req.end();
  });
}

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function signIn(login, host) {
  const res = await request("POST", "/api/auth/login", { host, body: { login, password: PASSWORD } });
  if (res.status !== 200 || !res.json?.user) throw new Error(`${login}: sign-in answered ${res.status} ${res.text.slice(0, 200)}`);
  const cookie = String(res.headers["set-cookie"]?.[0] ?? "").split(";")[0];
  return cookie;
}

async function main() {
  console.log(`BFF ${BFF.origin}`);
  const acme = await signIn(ACME.admin, ACME.host);
  const globex = await signIn(GLOBEX.admin, GLOBEX.host);
  const as = (cookie, host) => (method, path, body) => request(method, path, { host, cookie, body });
  const a = as(acme, ACME.host);
  const g = as(globex, GLOBEX.host);

  console.log("Tenant administration");
  const list = await a("GET", "/api/admin/tenants");
  check("an administrator sees only their own tenant", list.json?.operator === false && list.json?.tenants?.map((t) => t.id).join() === ACME.id, JSON.stringify(list.json));
  check("another tenant is not found", (await a("GET", `/api/admin/tenants/${GLOBEX.id}`)).status === 404);
  check("another tenant's teams are not found", (await a("GET", `/api/admin/tenants/${GLOBEX.id}/teams`)).status === 404);
  const detail = await a("GET", `/api/admin/tenants/${ACME.id}`);
  const acmeOrg = detail.json?.orgs?.[0]?.id;
  check("the tenant's organisations are read from iTop", detail.status === 200 && Boolean(acmeOrg), detail.text.slice(0, 200));
  check("host names are the operator's", (await a("PUT", `/api/admin/tenants/${ACME.id}/hostnames`, { hostnames: ["evil.localhost"] })).status === 403);

  console.log("Profiles");
  const profiles = await a("GET", "/api/admin/profiles");
  const admin = profiles.json?.profiles?.find((p) => p.name === "Administrator");
  check("Administrator is not grantable by a customer administrator", admin?.grantable === false);
  const people = await a("GET", `/api/admin/tenants/${ACME.id}/people?q=a`);
  const person = people.json?.items?.[0];
  check("the member picker finds the tenant's people", people.status === 200 && Boolean(person), people.text.slice(0, 200));
  if (person && admin) {
    const res = await a("POST", "/api/admin/users", {
      type: "local",
      login: `zz-e2e-admin-${STAMP}`,
      password: "Long-enough-2026!",
      contact: { id: person.id },
      profileIds: [admin.id],
    });
    check("creating an administrator is refused", res.status === 403, `${res.status} ${res.text.slice(0, 200)}`);
  }

  console.log("Teams");
  const team = await a("POST", `/api/admin/tenants/${ACME.id}/teams`, { name: `zz-e2e-team-${STAMP}`, orgId: acmeOrg });
  check("a team is created in the tenant's organisation", team.status === 201, `${team.status} ${team.text.slice(0, 300)}`);
  check("a team in another tenant's organisation is refused", (await a("POST", `/api/admin/tenants/${ACME.id}/teams`, { name: "zz-e2e-x", orgId: 14 })).status === 400);
  if (team.status === 201 && person) {
    const members = await a("PATCH", `/api/admin/tenants/${ACME.id}/teams/${team.json.id}`, { memberIds: [person.id] });
    check("a member is added", members.json?.members?.some((m) => m.id === person.id), members.text.slice(0, 300));
    check("the other tenant cannot change it", (await g("PATCH", `/api/admin/tenants/${ACME.id}/teams/${team.json.id}`, { memberIds: [] })).status === 404);
    const del = await a("DELETE", `/api/objects/Team/${team.json.id}`);
    check("cleanup: the team is deleted", del.status === 200 || del.status === 204, `${del.status} ${del.text.slice(0, 200)}`);
  }

  console.log("Organisations");
  const org = await a("POST", `/api/admin/tenants/${ACME.id}/orgs`, { name: `zz-e2e-org-${STAMP}`, parentId: acmeOrg });
  check("an organisation is added under one of theirs", org.status === 201, `${org.status} ${org.text.slice(0, 300)}`);
  check("a parent from another tenant is refused", (await a("POST", `/api/admin/tenants/${ACME.id}/orgs`, { name: "zz-e2e-y", parentId: 14 })).status === 400);
  if (org.status === 201) {
    const again = await a("GET", `/api/admin/tenants/${ACME.id}/orgs`);
    check("the new organisation is the tenant's at once", again.json?.items?.some((o) => o.id === org.json.id));
    const inactive = await a("PATCH", `/api/admin/tenants/${ACME.id}/orgs/${org.json.id}`, { status: "inactive" });
    check("it can be made inactive", inactive.json?.status === "inactive", inactive.text.slice(0, 200));
    const del = await a("DELETE", `/api/objects/Organization/${org.json.id}`);
    check("cleanup: the organisation is deleted", del.status === 200 || del.status === 204, `${del.status} ${del.text.slice(0, 200)}`);
  }

  console.log("Branding");
  const brand = await a("PUT", `/api/admin/tenants/${ACME.id}/branding`, { productName: "Acme Desk e2e", accentColor: "#0ea5e9" });
  check("branding is saved", brand.status === 200 && brand.json?.branding?.accentColor === "#0ea5e9");
  const byHost = await request("GET", "/api/branding", { host: ACME.host });
  check("the tenant's host name serves its branding before sign-in", byHost.json?.branding?.productName === "Acme Desk e2e");
  const other = await request("GET", "/api/branding", { host: GLOBEX.host });
  check("another host name does not", other.json?.branding?.productName !== "Acme Desk e2e");
  check("the platform's own address has none", (await request("GET", "/api/branding")).json?.branding === null);
  check("a bad colour is refused", (await a("PUT", `/api/admin/tenants/${ACME.id}/branding`, { accentColor: "red" })).status === 400);
  await a("PUT", `/api/admin/tenants/${ACME.id}/branding`, { productName: "", accentColor: "" });

  console.log("Email domains");
  const domain = `zz-e2e-${STAMP}.example`;
  const claimed = await a("PUT", `/api/admin/tenants/${ACME.id}/email-domains`, { emailDomains: [{ domain, orgId: acmeOrg }] });
  check("an email domain is claimed", claimed.status === 200, claimed.text.slice(0, 200));
  check("another tenant cannot claim it", (await g("PUT", `/api/admin/tenants/${GLOBEX.id}/email-domains`, { emailDomains: [{ domain, orgId: 14 }] })).status === 400);
  check("a public mail provider is refused", (await a("PUT", `/api/admin/tenants/${ACME.id}/email-domains`, { emailDomains: [{ domain: "gmail.com", orgId: acmeOrg }] })).status === 400);

  console.log("Self-registration");
  const options = await request("GET", "/api/auth/options", { host: ACME.host });
  if (!options.json?.selfRegistration) {
    console.log("  skip (SELF_REGISTRATION is off or password reset by email is not set up)");
  } else {
    const email = `pat.${STAMP}@${domain}`;
    check("an unclaimed domain is refused", (await request("POST", "/api/auth/register", { host: ACME.host, body: { lastName: "Lee", email: `x@nobody-${STAMP}.example` } })).status === 400);
    check("on another tenant's site the domain is refused", (await request("POST", "/api/auth/register", { host: GLOBEX.host, body: { lastName: "Lee", email } })).status === 400);
    const reg = await request("POST", "/api/auth/register", { host: ACME.host, body: { firstName: "Pat", lastName: `Lee ${STAMP}`, email } });
    check("registration answers 202", reg.status === 202, `${reg.status} ${reg.text.slice(0, 200)}`);
    let mail;
    for (let i = 0; i < 30 && !mail; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const found = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json()).catch(() => undefined);
      mail = found?.messages?.[0];
    }
    check("the set-password mail arrives", Boolean(mail));
    const users = await a("GET", `/api/admin/users?q=${encodeURIComponent(email)}`);
    const account = users.json?.items?.find((u) => u.login === email);
    check("a portal account exists, in the tenant", Boolean(account) && account.profiles.includes("Portal user"), users.text.slice(0, 300));
    if (account) {
      const off = await a("PATCH", `/api/admin/users/${account.id}`, { status: "disabled" });
      check("cleanup: the account is disabled", off.status === 200, off.text.slice(0, 200));
    }
  }
  await a("PUT", `/api/admin/tenants/${ACME.id}/email-domains`, { emailDomains: [] });

  console.log("Language");
  check("Arabic is kept", (await a("PUT", "/api/auth/language", { language: "ar" })).status === 200);
  check("…and returned with the user", (await a("GET", "/api/auth/me")).json?.user?.language === "ar");
  check("English is kept", (await a("PUT", "/api/auth/language", { language: "en" })).json?.language === "en");

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
