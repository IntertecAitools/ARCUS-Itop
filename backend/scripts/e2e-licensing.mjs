/**
 * Licensing end to end, against a running BFF (LICENSING=enforce, deployed:
 * TENANCY off) and the local system of record.
 *
 * Signs in as an administrator, then:
 *   - reads the status and the installation id;
 *   - issues an Essentials licence for this installation with the
 *     development key (backend/.licence-dev/), checks it, installs it with
 *     the terms accepted, and checks the edition is applied at once:
 *     changes and problems refused (403 LICENCE_FEATURE), custom queries
 *     refused, tickets and the standard dashboards still answer;
 *   - refuses an edited licence and leaves the installed one in place;
 *   - upgrades to Professional: changes answer, single sign-on is in the
 *     features, an audit-class query is still refused (Enterprise);
 *   - reads the licence page: usage counted live (agents, CIs), the history;
 *   - downloads the usage report and verifies its signature with the
 *     installation's public key; an edit breaks it.
 * The licences it installs stay in the BFF database: remove the licence
 * tables afterwards if this was a throwaway run (backend/README.md,
 * "Licensing", "Live check").
 *
 *   npm run e2e:licensing                                  BFF on http://127.0.0.1:4610
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:licensing
 *
 * The BFF needs LICENSING=enforce and the development key trusted (any
 * non-production build). MFA stays on. The account comes from
 * backend/e2e.local.json (git-ignored):
 * { "licensing": { "admin": { "login", "password", "totpSecret" } } } -- a
 * staff Administrator already enrolled in MFA.
 */
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";
import { buildLicenceFields } from "../src/platform/licensing/issuer/issue.ts";
import { devSigner } from "../src/platform/licensing/issuer/signers.ts";
import { signLicence, verifyDocument } from "../src/platform/licensing/sdk/index.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const DEV_KEYS = fileURLToPath(new URL("../.licence-dev", import.meta.url));
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4610");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5173";

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
} catch {
  config = {};
}
const account = config.licensing?.admin;
if (!account?.login || !account?.password || !account?.totpSecret) {
  console.error('Put { "licensing": { "admin": { "login", "password", "totpSecret" } } } in backend/e2e.local.json.');
  process.exit(2);
}

let cookie = "";
let passed = 0;
const failures = [];

function request(method, path, body) {
  return new Promise((resolve, reject) => {
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
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const errorCode = (res) => res.json?.error?.code;

function keepCookie(res) {
  const set = res.headers["set-cookie"];
  if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
}

async function signIn() {
  const login = await request("POST", "/api/auth/login", { login: account.login, password: account.password });
  if (login.status !== 200) throw new Error(`sign-in: ${login.status} ${login.text.slice(0, 200)}`);
  keepCookie(login);
  if (login.json.user) return login.json.user;
  // A code is accepted once: if the last run used this 30-second step, wait for the next.
  for (const offset of [0, 1]) {
    if (offset) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
    const verify = await request("POST", "/api/auth/mfa/verify", { code: totpAt(account.totpSecret, timeStep(Date.now())) });
    if (verify.status === 200) {
      keepCookie(verify);
      return verify.json.user;
    }
    if (offset) throw new Error(`MFA code refused: ${verify.status} ${verify.text.slice(0, 200)}`);
  }
}

let serial = Date.now() % 100_000;
/** A licence for this installation, signed with the development key. */
async function issue(installationId, edition, agents = 50) {
  serial += 1;
  const id = `ARC-${new Date().getUTCFullYear()}-${String(serial).padStart(6, "0")}`;
  const fields = buildLicenceFields(
    {
      customer: "Live check",
      orderRef: "E2E",
      type: "subscription",
      termYears: 1,
      order: { edition, deployment: "deployed", agents },
      binding: `install:${installationId}`,
      validFrom: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    },
    id,
    new Date(),
  );
  return (await signLicence(fields, devSigner(DEV_KEYS))).text;
}

async function main() {
  await signIn();
  console.log("\nStatus before");
  const before = await request("GET", "/api/licence/status");
  check("the status answers (licensing is on)", before.status === 200, `${before.status} ${before.text.slice(0, 200)}`);
  console.log(`        state ${before.json?.state}, edition ${before.json?.edition ?? "none"}`);
  const detail = await request("GET", "/api/licence");
  check("the licence page answers for an administrator", detail.status === 200, `${detail.status}`);
  const installationId = detail.json?.installation?.id;
  check("the installation has an id and a report key", /^[0-9a-f-]{36}$/.test(installationId ?? "") && /BEGIN PUBLIC KEY/.test(detail.json?.installation?.reportPublicKey ?? ""));

  console.log("\nEssentials");
  const ess = await issue(installationId, "ESS");
  const checked = await request("POST", "/api/licence/check", { text: ess });
  check("the check reads the edition without saving it", checked.status === 200 && checked.json?.ok === true && checked.json?.summary?.edition === "ESS", checked.text.slice(0, 200));
  const installed = await request("PUT", "/api/licence", { text: ess, acceptEula: true });
  check("installs with the terms accepted", installed.status === 200, `${installed.status} ${installed.text.slice(0, 200)}`);
  const sEss = (await request("GET", "/api/licence/status")).json;
  check("applies at once: Essentials, valid", sEss?.edition === "ESS" && sEss?.state === "valid", `${sEss?.edition} ${sEss?.state}`);
  check("Essentials has no changes, no single sign-on", !sEss?.features?.includes("change") && !sEss?.features?.includes("sso"));
  const change = await request("GET", "/api/objects/Change?limit=1");
  check("changes are refused (LICENCE_FEATURE)", change.status === 403 && errorCode(change) === "LICENCE_FEATURE", `${change.status} ${errorCode(change)}`);
  check("the refusal names the edition that has it", change.json?.error?.details?.includedIn === "PRO", JSON.stringify(change.json?.error?.details));
  const problem = await request("GET", "/api/objects/Problem?limit=1");
  check("problems are refused", errorCode(problem) === "LICENCE_FEATURE");
  const query = await request("POST", "/api/queries/run", { query: { name: "", recordType: "UserRequest" } });
  check("custom queries are refused on Essentials", errorCode(query) === "LICENCE_FEATURE", `${query.status} ${errorCode(query)}`);
  const tickets = await request("GET", "/api/objects/UserRequest?limit=1");
  check("tickets still answer", tickets.status === 200, `${tickets.status}`);
  const dashboards = await request("GET", "/api/meta/dashboards");
  check("the standard dashboards answer on Essentials", dashboards.status === 200, `${dashboards.status} ${errorCode(dashboards)}`);
  const modules = (await request("GET", "/api/meta/modules")).json;
  const ids = (modules?.modules ?? []).map((m) => m.id);
  check("the module list leaves changes out", ids.length > 0 && !ids.includes("changes"), ids.join(","));

  console.log("\nAn edited licence");
  const edited = ess.replace(/([A-Za-z0-9_-])(\r?\n-----END)/, (_m, c, end) => `${c === "A" ? "B" : "A"}${end}`);
  const refused = await request("PUT", "/api/licence", { text: edited, acceptEula: true });
  check("is refused", refused.status >= 400 && refused.status < 500, `${refused.status}`);
  check("and the installed one stays", (await request("GET", "/api/licence/status")).json?.edition === "ESS");

  console.log("\nProfessional");
  const pro = await issue(installationId, "PRO");
  const up = await request("PUT", "/api/licence", { text: pro, acceptEula: true });
  check("the upgrade installs", up.status === 200, `${up.status} ${up.text.slice(0, 200)}`);
  const sPro = (await request("GET", "/api/licence/status")).json;
  check("Professional now, with single sign-on", sPro?.edition === "PRO" && sPro?.features?.includes("sso"));
  check("changes answer now", (await request("GET", "/api/objects/Change?limit=1")).status === 200);
  const audit = await request("POST", "/api/queries/run", { query: { name: "", recordType: "AuditRule" } });
  check("an audit query is still refused (Enterprise)", errorCode(audit) === "LICENCE_FEATURE", `${audit.status} ${errorCode(audit)}`);

  console.log("\nThe licence page");
  const page = (await request("GET", "/api/licence")).json;
  const usage = Object.fromEntries((page?.usage ?? []).map((r) => [r.metric, r]));
  console.log(`        agents ${usage.agents?.used}/${usage.agents?.limit}, CIs ${usage.cis?.used}/${usage.cis?.limit}`);
  check("agents are counted from the accounts", Number.isInteger(usage.agents?.used) && usage.agents?.limit === 50);
  check("CIs are counted, against the Professional limit", Number.isInteger(usage.cis?.used) && usage.cis?.limit === 10_000);
  check("the history shows the installs", (page?.history ?? []).filter((e) => e.label === "Key installed").length >= 2);

  console.log("\nUsage report");
  const day = new Date().toISOString().slice(0, 10);
  const report = await request("GET", `/api/licence/usage-report?from=${day}&to=${day}`);
  check("downloads", report.status === 200, `${report.status}`);
  const publicKeyPem = page.installation.reportPublicKey;
  const verified = verifyDocument(report.text, { kind: "usage_report", publicKeyPem });
  check("its signature verifies with the installation's key", verified.ok === true, verified.ok ? "" : verified.message);
  check("an edited report does not", verifyDocument(report.text.replace('"agents":', '"agents": 0, "x":'), { kind: "usage_report", publicKeyPem }).ok === false);
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
