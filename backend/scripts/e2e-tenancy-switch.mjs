/**
 * The switch of a single-company installation to multi-customer mode
 * (TENANCY=on), with its licence issued from the operator Licences page.
 * Run against a BFF started with TENANCY=on, PLATFORM_LOGINS=<operator>,
 * LICENSING=warn|enforce and a signer (LICENCE_SIGNER), after
 * `npm run tenants -- set <tenant> --name … --all-orgs`.
 *
 *   - the operator signs in on the platform's address: unscoped, sees the
 *     tenant, and has the Licences page;
 *   - issues the tenant's licence there; it is installed at once;
 *   - a member of the tenant signs in: held to the tenant, its licence and
 *     edition apply, tickets read;
 *   - the member cannot change shared reference data (an FAQ), which only
 *     the operator may.
 *
 *   npm run e2e:tenancy-switch                              BFF on http://127.0.0.1:4630
 *   E2E_BFF=… E2E_TENANT=intertec npm run e2e:tenancy-switch
 *
 * MFA stays on. Accounts in backend/e2e.local.json (git-ignored):
 * { "tenancySwitch": { "operator": {login, password, totpSecret},
 *   "member": {login, password, totpSecret} } } -- the operator is listed in
 * PLATFORM_LOGINS; the member is a staff account of the tenant. Both
 * already enrolled in MFA.
 */
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4630");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5173";
const TENANT = process.env.E2E_TENANT ?? "intertec";

const config = (() => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
})();
const accounts = config.tenancySwitch ?? {};
for (const who of ["operator", "member"]) {
  if (!accounts[who]?.login || !accounts[who]?.password || !accounts[who]?.totpSecret) {
    console.error('Put { "tenancySwitch": { "operator": {…}, "member": {…} } } in backend/e2e.local.json.');
    process.exit(2);
  }
}

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function session() {
  let cookie = "";
  const request = (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          method,
          hostname: BFF.hostname,
          port: BFF.port,
          path,
          headers: {
            origin: ORIGIN,
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
            const set = res.headers["set-cookie"];
            if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
            resolve({ status: res.statusCode, text, json });
          });
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  const signIn = async (account) => {
    const login = await request("POST", "/api/auth/login", { login: account.login, password: account.password });
    if (login.status !== 200) return login;
    if (login.json?.user) return login;
    for (const offset of [0, 1]) {
      if (offset) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
      const verify = await request("POST", "/api/auth/mfa/verify", { code: totpAt(account.totpSecret, timeStep(Date.now())) });
      if (verify.status === 200 || offset) return verify;
    }
  };
  return { request, signIn };
}

const code = (res) => res.json?.error?.code;

async function main() {
  console.log("\nOperator");
  const op = session();
  const opIn = await op.signIn(accounts.operator);
  check("signs in on the platform's address", opIn.status === 200, `${opIn.status} ${opIn.text.slice(0, 200)}`);
  const tenants = await op.request("GET", "/api/admin/tenants");
  check("is the operator and sees the tenant", tenants.json?.operator === true && (tenants.json?.tenants ?? []).some((t) => t.id === TENANT), tenants.text.slice(0, 200));
  const desk = await op.request("GET", "/api/platform/licences");
  check("has the Licences page", desk.status === 200, `${desk.status} ${desk.text.slice(0, 200)}`);

  const issued = await op.request("POST", "/api/platform/licences", {
    customer: "Intertec",
    orderRef: "E2E-SWITCH",
    type: "subscription",
    termYears: 1,
    edition: "ENT",
    deployment: "saas",
    binding: `tenant:${TENANT}`,
    agents: 50,
  });
  check("issues the tenant's licence from the page", issued.status === 201, `${issued.status} ${issued.text.slice(0, 300)}`);
  check("and it is installed at once", issued.json?.installed === true, JSON.stringify(issued.json?.installed));

  console.log("\nMember of the tenant");
  const me = session();
  const meIn = await me.signIn(accounts.member);
  check("signs in, held to the tenant", meIn.status === 200, `${meIn.status} ${meIn.text.slice(0, 200)}`);
  const status = (await me.request("GET", "/api/licence/status")).json;
  check("the tenant's licence applies: Enterprise, valid", status?.edition === "ENT" && status?.state === "valid", `${status?.edition} ${status?.state}`);
  const tickets = await me.request("GET", "/api/objects/UserRequest?limit=1");
  check("tickets read", tickets.status === 200, `${tickets.status}`);
  const faq = await me.request("GET", "/api/objects/FAQ?limit=1&fields=title");
  const faqId = faq.json?.items?.[0]?.id;
  if (faqId) {
    const edit = await me.request("PATCH", `/api/objects/FAQ/${faqId}`, { fields: { title: faq.json.items[0].fields?.title ?? "x" }, comment: "e2e" });
    check("cannot change shared reference data (an FAQ)", edit.status >= 400, `${edit.status} ${code(edit)}`);
  } else {
    console.log("        (no FAQ to try: skipped)");
  }
  const meDesk = await me.request("GET", "/api/platform/licences");
  check("has no Licences page", meDesk.status === 403 || meDesk.status === 404, `${meDesk.status}`);
}

try {
  await main();
} catch (err) {
  failures.push(String(err.message ?? err));
  console.log(`  FAIL  ${err.message ?? err}`);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
