/**
 * Root-cause evidence (the correlation assistant) end to end, against a
 * running BFF and iTop.
 *
 * Seeds, through the BFF as an administrator:
 *   - CIs: a database server, a web server, a power source the database
 *     server runs on (upstream in iTop's impact graph) and an application
 *     solution built on it (downstream);
 *   - changes: one on the database server that finished 2h before the first
 *     incident, one on the power source 5h before, and one 10 days earlier
 *     (outside the look-back);
 *   - a problem with four incidents (three on the database server, one on
 *     the web server), an unlinked incident with a similar title on the
 *     database server, an earlier problem on the same server, and a known
 *     error recorded on it.
 * Then reads GET /api/problems/:id/rca-evidence, as the administrator and as
 * a Problem Manager, and checks the ranking, the reasons, the look-back and
 * that "Draft with AI" is refused when the BFF has no API key. Everything it
 * creates is deleted at the end, pass or fail.
 *
 *   npm run e2e:rca                                       BFF on http://127.0.0.1:4090
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:rca
 *
 * MFA stays on. Accounts come from backend/e2e.local.json (git-ignored):
 * { "rca": { "orgId", "accounts": { "admin": {login, password, totpSecret},
 *   "problem": {…} } } } -- staff test accounts with the Administrator and the
 * Problem Manager profile, already enrolled in MFA.
 */
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4090");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5263";
const TAG = `e2e-rca ${new Date().toISOString().slice(0, 19)}`;

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, "utf8")).rca;
} catch {
  config = undefined;
}
if (!config?.accounts?.admin?.login || !config?.accounts?.problem?.login) {
  console.error('Put { "rca": { "orgId", "accounts": { "admin", "problem" } } } in backend/e2e.local.json.');
  process.exit(2);
}
const ORG = Number(config.orgId || 1);

let passed = 0;
const failures = [];
/** [class, id], deleted in reverse order at the end. */
const created = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/** One signed-in account: its own cookie. */
class Session {
  constructor(account) {
    this.account = account;
    this.cookie = "";
  }

  request(method, path, body) {
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
            ...(this.cookie ? { cookie: this.cookie } : {}),
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
            if (set) this.cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
            resolve({ status: res.statusCode, text, json });
          });
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** Password, then a TOTP code (the next step's, if this one was just used). */
  async signIn() {
    const { login, password, totpSecret } = this.account;
    const res = await this.request("POST", "/api/auth/login", { login, password });
    if (res.status !== 200) throw new Error(`sign-in ${login}: ${res.status} ${res.text.slice(0, 200)}`);
    if (res.json.user) return res.json.user;
    if (!totpSecret) throw new Error(`${login} needs MFA but e2e.local.json has no totpSecret`);
    for (const offset of [0, 1]) {
      if (offset) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
      const verify = await this.request("POST", "/api/auth/mfa/verify", {
        code: totpAt(totpSecret, timeStep(Date.now())),
      });
      if (verify.status === 200) return verify.json.user;
      if (offset) throw new Error(`MFA code refused for ${login}: ${verify.status} ${verify.text.slice(0, 200)}`);
    }
  }
}

const admin = new Session(config.accounts.admin);
const manager = new Session(config.accounts.problem);

async function create(className, fields) {
  const res = await admin.request("POST", `/api/objects/${className}`, { fields, comment: TAG });
  if (res.status !== 201) throw new Error(`create ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  const id = res.json.object.id;
  created.push([className, id]);
  return id;
}

async function link(className, id, attribute, targetId) {
  const res = await admin.request("POST", `/api/objects/${className}/${id}/links/${attribute}`, { targetId });
  if (res.status >= 300) throw new Error(`link ${className}.${attribute}: ${res.status} ${res.text.slice(0, 300)}`);
}

const HOUR = 3_600_000;
const at = (ms) => new Date(ms).toISOString();

async function main() {
  await admin.signIn();
  check("administrator signed in (password + TOTP)", Boolean(admin.cookie));

  console.log("\nSetup");
  // The first incident opens a day ago; changes are placed around it.
  const first = Date.now() - 24 * HOUR;

  const power = await create("PowerSource", { name: `${TAG} PSU`, org_id: ORG });
  const db = await create("Server", { name: `${TAG} SRV-DB`, org_id: ORG, powerA_id: power });
  const web = await create("Server", { name: `${TAG} SRV-WEB`, org_id: ORG });
  const app = await create("ApplicationSolution", { name: `${TAG} Shop`, org_id: ORG });
  await link("ApplicationSolution", app, "functionalcis_list", db);

  const change = async (title, ci, startMs, endMs) => {
    const id = await create("NormalChange", {
      org_id: ORG,
      title: `${TAG} ${title}`,
      description: "Seeded by the RCA e2e",
      start_date: at(startMs),
      end_date: at(endMs),
    });
    await link("NormalChange", id, "functionalcis_list", ci);
    return id;
  };
  const dbChange = await change("patch database engine", db, first - 3 * HOUR, first - 2 * HOUR);
  const psuChange = await change("replace PSU firmware", power, first - 6 * HOUR, first - 5 * HOUR);
  const oldChange = await change("old database tuning", db, first - 240 * HOUR, first - 239 * HOUR);

  const problem = await create("Problem", {
    org_id: ORG,
    title: `${TAG} orders page times out`,
    description: "<p>Checkout times out. Reported by someone@example.com</p>",
    impact: "2",
    urgency: "2",
  });

  const incident = async (n, ci, linked = true, title = "orders page times out") => {
    const id = await create("Incident", {
      org_id: ORG,
      title: `${TAG} ${title}`,
      description: `<p>Incident ${n}</p>`,
      start_date: at(first + n * HOUR),
      ...(linked ? { parent_problem_id: problem } : {}),
    });
    await link("Incident", id, "functionalcis_list", ci);
    return id;
  };
  const firstIncident = await incident(0, db);
  await incident(1, db);
  await incident(2, db);
  await incident(3, web);
  const similar = await incident(4, db, false, "orders page times out again");

  const earlier = await create("Problem", {
    org_id: ORG,
    title: `${TAG} database slow last month`,
    description: "<p>Earlier</p>",
    impact: "3",
    urgency: "3",
  });
  await link("Problem", earlier, "functionalcis_list", db);
  const rca = await admin.request("PUT", `/api/problems/${earlier}/analysis`, {
    rootCause: "Connection pool too small after an engine patch",
    workaround: "",
    resolution: "",
  });
  const withExtension = rca.status === 200;
  console.log(`  (arcus-problem-rca extension ${withExtension ? "present" : "absent"}: ${rca.status})`);

  const knownError = await create("KnownError", {
    org_id: ORG,
    name: `${TAG} DB pool exhaustion`,
    symptom: "Timeouts on checkout",
    workaround: "Restart the pool",
  });
  await link("KnownError", knownError, "ci_list", db);
  console.log(`  problem ${problem}, CIs db ${db} web ${web} psu ${power} app ${app}, changes ${dbChange}/${psuChange}/${oldChange}`);

  console.log("\nEvidence, as the administrator");
  let res = await admin.request("GET", `/api/problems/${problem}/rca-evidence`);
  check("evidence answers", res.status === 200, `${res.status} ${res.text.slice(0, 300)}`);
  const e = res.json ?? {};
  check("nothing reported unreadable", (e.unavailable ?? []).length === 0, JSON.stringify(e.unavailable));
  check("four linked incidents", e.linkedIncidents?.length === 4, String(e.linkedIncidents?.length));
  check(
    "anchored on the first incident",
    e.anchor?.source === "incident" && e.linkedIncidents?.[0]?.id === String(firstIncident),
    JSON.stringify(e.anchor),
  );
  const dbCi = e.cis?.find((c) => c.id === String(db));
  check("SRV-DB is affected, named by 3 incidents", dbCi?.role === "affected" && dbCi?.incidentCount === 3, JSON.stringify(dbCi));
  check("the power source is upstream of SRV-DB", e.cis?.find((c) => c.id === String(power))?.role === "upstream",
    JSON.stringify(e.cis?.map((c) => [c.name, c.role])));
  check("the application solution is downstream", e.cis?.find((c) => c.id === String(app))?.role === "downstream");

  const changeOf = (id) => e.changes?.find((c) => c.id === String(id));
  const dbc = changeOf(dbChange);
  check("the database change is found, 2h before", Math.abs((dbc?.hoursBeforeFirstIncident ?? 99) - 2) < 0.1, JSON.stringify(dbc));
  check("the power-source change is found, on an upstream CI", changeOf(psuChange)?.cis?.[0]?.role === "upstream",
    JSON.stringify(changeOf(psuChange)));
  check("the change 10 days earlier is not", !changeOf(oldChange));

  const top = e.candidates?.[0];
  check("the database change ranks first", top?.kind === "change" && top?.record?.id === String(dbChange),
    JSON.stringify(e.candidates?.map((c) => [c.record.label, c.score])));
  check(
    "its reasons are spelled out",
    top?.reasons?.some((r) => /^Finished 2h before I-/.test(r.text)) &&
      top?.reasons?.some((r) => /named by 3 of 4 incidents/.test(r.text)),
    JSON.stringify(top?.reasons),
  );
  check("the upstream change ranks below it",
    e.candidates?.findIndex((c) => c.record.id === String(psuChange)) > 0);
  check("SRV-DB itself is a candidate", e.candidates?.some((c) => c.kind === "ci" && c.record.id === String(db)));

  const sim = e.similarIncidents?.find((i) => i.id === String(similar));
  check("the unlinked incident is listed as similar", sim?.matches?.some((m) => m.startsWith("same CI")), JSON.stringify(sim));
  const past = e.problems?.find((p) => p.id === String(earlier));
  check("the earlier problem is listed, sharing SRV-DB", past?.sharedCis?.length === 1, JSON.stringify(past));
  if (withExtension) check("with its recorded root cause", /pool too small/.test(past?.rootCause ?? ""));
  check("the known error is listed", e.knownErrors?.some((k) => k.id === String(knownError)));
  check("a known-error candidate", e.candidates?.some((c) => c.kind === "known_error"));

  res = await admin.request("GET", `/api/problems/${problem}/rca-evidence?lookbackHours=1`);
  check("a 1-hour look-back drops the database change",
    res.status === 200 && !res.json.changes.some((c) => c.id === String(dbChange)), res.text.slice(0, 200));
  res = await admin.request("GET", `/api/problems/${problem}/rca-evidence?lookbackHours=0`);
  check("a 0-hour look-back is a 400", res.status === 400, String(res.status));
  res = await admin.request("GET", `/api/problems/99999999/rca-evidence`);
  check("an unknown problem is a 404", res.status === 404, String(res.status));

  console.log("\nEvidence, as a Problem Manager");
  await manager.signIn();
  res = await manager.request("GET", `/api/problems/${problem}/rca-evidence`);
  check("evidence answers for the Problem Manager", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
  check("same first candidate", res.json?.candidates?.[0]?.record?.id === String(dbChange),
    JSON.stringify(res.json?.candidates?.map((c) => c.record.label)));
  check("readable sources reported honestly", Array.isArray(res.json?.unavailable), JSON.stringify(res.json?.unavailable));

  console.log("\nDraft with AI");
  const aiOn = e.ai?.enabled === true;
  console.log(`  (this BFF ${aiOn ? "has" : "has no"} ANTHROPIC_API_KEY)`);
  if (!aiOn) {
    res = await admin.request("POST", `/api/problems/${problem}/rca-draft`, {});
    check("drafting is refused without an API key (403)", res.status === 403, `${res.status} ${res.text.slice(0, 200)}`);
  } else {
    res = await admin.request("POST", `/api/problems/${problem}/rca-draft`, {});
    check("a draft comes back", res.status === 200 && typeof res.json?.rootCause === "string", res.text.slice(0, 300));
    check("the problem's email address was redacted", res.json?.redactions?.emails >= 1);
  }
}

async function cleanup() {
  console.log("\nCleanup");
  for (const [className, id] of created.reverse()) {
    const res = await admin.request("DELETE", `/api/objects/${className}/${id}?comment=${encodeURIComponent(TAG)}`);
    console.log(`  ${res.status < 300 ? "deleted" : `NOT deleted (${res.status})`} ${className} ${id}`);
  }
}

try {
  await main();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.log(`  FAIL  aborted: ${error.message}`);
} finally {
  if (admin.cookie) await cleanup();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
