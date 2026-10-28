/**
 * SLA dashboard end to end, against a running BFF and the local iTop.
 *
 * Signs in as a staff account, then builds a small SLA set-up through the
 * BFF: three services, each covered by a customer contract of the account's
 * organisation through its own SLA, with TTO targets of 600, 1 and 2 minutes
 * (and TTR targets above them). It opens one incident per service, and a
 * user request no SLT covers, waits until the 1-minute TTO has run out and
 * the 2-minute one is past 75%, and checks that:
 *   - the dashboard counts the four tickets, in the right breakdowns;
 *   - each incident's state is within / at risk / breached, with the SLT
 *     target iTop applied and a deadline, and the request has no SLA;
 *   - every drill-down (state, team, priority, customer, ticket type)
 *     returns the tickets behind the count;
 *   - malformed queries are refused with 400.
 * Everything it creates in iTop is deleted at the end, pass or fail.
 *
 *   npm run e2e:sla                                     BFF on http://127.0.0.1:4040
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:sla
 *
 * The account: { "sla": { "login", "password", "totpSecret" } } in
 * backend/e2e.local.json (git-ignored), MFA on; the first run enrols it and
 * saves the secret. It must be allowed to create services, contracts, SLAs
 * and SLTs (an administrator).
 */
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4040");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5213";
const STAMP = new Date().toISOString().slice(0, 19);
const TAG = `e2e-sla ${STAMP}`;

if (!fs.existsSync(CONFIG)) {
  console.error(`No ${CONFIG.pathname}: add { "sla": { "login", "password" } } (see the comment at the top).`);
  process.exit(2);
}
const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const account = config.sla;
if (!account?.login || !account?.password) {
  console.error('e2e.local.json has no "sla" account.');
  process.exit(2);
}

let cookie = "";
let passed = 0;
const failures = [];
const created = [];

let signingIn = false;

/**
 * One BFF call. A 401 mid-run (the session outlived its limits, say while
 * the machine slept through the wait) signs in again once and retries, so
 * the clean-up still runs.
 */
async function request(method, path, body) {
  const res = await send(method, path, body);
  if (res.status !== 401 || signingIn || path.startsWith("/api/auth/")) return res;
  console.log("  (session ended; signing in again)");
  await signIn();
  return send(method, path, body);
}

function send(method, path, body) {
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

async function create(className, fields) {
  const res = await request("POST", `/api/objects/${className}`, { fields, comment: TAG });
  if (res.status !== 201) throw new Error(`create ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  const id = res.json.object.id;
  created.push([className, id]);
  return id;
}

async function link(className, id, attcode, targetId, fields) {
  const res = await request("POST", `/api/objects/${className}/${id}/links/${attcode}`, { targetId, fields });
  if (res.status !== 201) throw new Error(`link ${className}.${attcode}: ${res.status} ${res.text.slice(0, 300)}`);
}

async function getFields(className, id, fields) {
  const res = await request("GET", `/api/objects/${className}/${id}?fields=${fields}`);
  if (res.status !== 200) throw new Error(`read ${className} ${id}: ${res.status} ${res.text.slice(0, 200)}`);
  return res.json.object?.fields ?? res.json.fields ?? {};
}

function keepCookie(res) {
  const set = res.headers["set-cookie"];
  if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
}

const code = (secret, offset = 0) => totpAt(secret, timeStep(Date.now()) + offset);

/** Password, then the MFA step: enrols (saving the secret) or answers with a code. */
async function signIn() {
  signingIn = true;
  try {
    return await signInOnce();
  } finally {
    signingIn = false;
  }
}

async function signInOnce() {
  const login = await request("POST", "/api/auth/login", { login: account.login, password: account.password });
  if (login.status !== 200) throw new Error(`sign-in: ${login.status} ${login.text.slice(0, 200)}`);
  keepCookie(login);
  if (login.json.user) {
    check("signed in (this BFF has MFA off)", true);
    return login.json.user;
  }

  if (login.json.mfa?.step === "enrol") {
    const enrol = await request("GET", "/api/auth/mfa/enrol");
    if (enrol.status !== 200) throw new Error(`MFA set-up: ${enrol.status} ${enrol.text.slice(0, 200)}`);
    account.totpSecret = enrol.json.secret;
    const done = await request("POST", "/api/auth/mfa/enrol", { code: code(account.totpSecret) });
    if (done.status !== 200) throw new Error(`MFA enrolment: ${done.status} ${done.text.slice(0, 200)}`);
    keepCookie(done);
    fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
    check("enrolled in MFA; secret saved to e2e.local.json", Boolean(done.json.user));
    return done.json.user;
  }

  if (!account.totpSecret) throw new Error("the account is enrolled in MFA but e2e.local.json has no totpSecret");
  // A code is accepted once: if another run used this 30-second step, the
  // next step's code is the one to send.
  for (const offset of [0, 1]) {
    if (offset) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
    const verify = await request("POST", "/api/auth/mfa/verify", { code: code(account.totpSecret) });
    if (verify.status === 200) {
      keepCookie(verify);
      check("signed in with password and a TOTP code", Boolean(verify.json.user));
      return verify.json.user;
    }
    if (offset) throw new Error(`MFA code refused: ${verify.status} ${verify.text.slice(0, 200)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A service under its own SLA (TTO / TTR in minutes) on the organisation's contract. */
async function coveredService(contractId, orgId, label, ttoMinutes, ttrMinutes, priority) {
  const serviceId = await create("Service", { name: `${TAG} ${label}`, org_id: orgId });
  const slaId = await create("SLA", { name: `${TAG} ${label} SLA`, org_id: orgId });
  for (const [metric, value] of [
    ["tto", ttoMinutes],
    ["ttr", ttrMinutes],
  ]) {
    const sltId = await create("SLT", {
      name: `${TAG} ${label} ${metric}`,
      metric,
      priority,
      request_type: "incident",
      value,
      unit: "minutes",
    });
    await link("SLA", slaId, "slts_list", sltId);
  }
  await link("CustomerContract", contractId, "services_list", serviceId, { sla_id: slaId });
  return serviceId;
}

async function main() {
  const user = await signIn();
  const orgId = Number(user.orgId || 1);

  console.log("\nSetup");
  const callerId = await create("Person", { name: "Caller", first_name: `E2E SLA ${Date.now().toString(36)}`, org_id: orgId });
  const ticketFields = (title, extra = {}) => ({
    org_id: orgId,
    caller_id: callerId,
    title: `${TAG} ${title}`,
    description: "<p>Opened by the SLA e2e script</p>",
    impact: "3",
    urgency: "3",
    ...extra,
  });

  // iTop derives priority from impact and urgency: a throwaway incident
  // tells which priority the SLTs must target.
  const probeId = await create("Incident", ticketFields("priority probe"));
  const priority = String((await getFields("Incident", probeId, "priority")).priority ?? "");
  check("iTop computed a priority for impact 3 / urgency 3", /^[1-4]$/.test(priority), priority);

  const contractId = await create("CustomerContract", {
    name: `${TAG} contract`,
    org_id: orgId,
    provider_id: orgId,
  });
  const relaxed = await coveredService(contractId, orgId, "relaxed", 600, 1200, priority);
  const tight = await coveredService(contractId, orgId, "tight", 1, 600, priority);
  const tense = await coveredService(contractId, orgId, "tense", 2, 600, priority);
  console.log(`  org ${orgId}, contract ${contractId}, priority ${priority}`);

  const withinId = await create("Incident", ticketFields("within target", { service_id: relaxed }));
  const breachId = await create("Incident", ticketFields("will breach", { service_id: tight }));
  const riskId = await create("Incident", ticketFields("will be at risk", { service_id: tense }));
  const riskCreatedAt = Date.now();
  const requestId = await create("UserRequest", ticketFields("no SLA"));
  const refs = {};
  for (const [cls, id] of [
    ["Incident", withinId],
    ["Incident", breachId],
    ["Incident", riskId],
    ["UserRequest", requestId],
  ]) {
    refs[id] = (await getFields(cls, id, "ref")).ref;
  }
  console.log(`  incidents ${refs[withinId]}, ${refs[breachId]}, ${refs[riskId]}; request ${refs[requestId]}`);

  console.log("\nRight away");
  let res = await request("GET", `/api/sla/tickets?org=${orgId}`);
  check("tickets answer 200", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
  const fresh = res.json?.items?.find((t) => t.id === String(withinId));
  check(
    "a fresh incident is within target, with the SLT goal and a deadline",
    fresh?.state === "within" && fresh.tto.state === "within" && fresh.tto.goalSeconds === 36_000 && Boolean(fresh.tto.deadline),
    JSON.stringify(fresh?.tto),
  );
  check("its TTR runs too, against 1200 minutes", fresh?.ttr.goalSeconds === 72_000 && fresh.ttr.state === "within");

  // 95 s after the 2-minute incident opened: the 1-minute TTO has run out,
  // the 2-minute one is about 80% used.
  const wait = riskCreatedAt + 95_000 - Date.now();
  console.log(`\nWaiting ${Math.ceil(wait / 1000)} s for the short targets to run down`);
  if (wait > 0) await sleep(wait);

  console.log("\nStates");
  res = await request("GET", `/api/sla/tickets?org=${orgId}`);
  const byId = Object.fromEntries((res.json?.items ?? []).map((t) => [t.id, t]));
  const breach = byId[String(breachId)];
  const risk = byId[String(riskId)];
  const req = byId[String(requestId)];
  check("1-minute TTO incident is breached", breach?.state === "breached" && breach.tto.state === "breached", JSON.stringify(breach?.tto));
  check(
    "2-minute TTO incident is at risk (75–99% used)",
    risk?.state === "at_risk" && risk.tto.percentUsed >= 75 && risk.tto.percentUsed < 100,
    JSON.stringify(risk?.tto),
  );
  check("the 10-hour incident is still within target", byId[String(withinId)]?.state === "within");
  check("the request no SLT covers has no SLA", req?.state === "none" && req.className === "UserRequest", JSON.stringify(req));
  const ids = (res.json?.items ?? []).map((t) => t.id);
  check(
    "most urgent first: breached before at risk before within",
    ids.indexOf(String(breachId)) < ids.indexOf(String(riskId)) && ids.indexOf(String(riskId)) < ids.indexOf(String(withinId)),
  );

  // Straight away: the 2-minute incident is at risk only until 120 s after it
  // opened. Later checks allow for it having breached since (a slow machine).
  const drill = async (qs) => {
    const r = await request("GET", `/api/sla/tickets?${qs}`);
    if (r.status !== 200) throw new Error(`tickets?${qs}: ${r.status} ${r.text.slice(0, 200)}`);
    return r.json.items.map((x) => x.id);
  };
  let got = await drill("state=at_risk");
  check("state=at_risk has the at-risk incident, not the breach", got.includes(String(riskId)) && !got.includes(String(breachId)));

  console.log("\nDashboard");
  res = await request("GET", "/api/sla/dashboard");
  const d = res.json;
  check("dashboard answers 200", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
  const t = d?.totals ?? {};
  check(
    "totals add up and count at least our tickets",
    t.total === t.within + t.atRisk + t.breached + t.none && t.atRisk + t.breached >= 2 && t.within >= 1 && t.none >= 1,
    JSON.stringify(t),
  );
  const customer = d?.byCustomer?.find((g) => g.key === String(orgId));
  check("the customer breakdown has our organisation with its breach", customer?.breached >= 1 && customer.total >= 4, JSON.stringify(customer));
  const prio = d?.byPriority?.find((g) => g.key === priority);
  check("the priority breakdown has our priority", prio?.atRisk + prio?.breached >= 2, JSON.stringify(prio));
  const noTeam = d?.byTeam?.find((g) => g.key === "");
  check("tickets without a team are grouped as No team", noTeam?.label === "No team" && noTeam.total >= 4, JSON.stringify(noTeam));
  check("at risk means 75%", d?.atRiskPercent === 75);

  res = await request("GET", "/api/sla/dashboard?type=request");
  check(
    "requests only: no incidents counted",
    res.status === 200 && res.json.type === "request" && res.json.totals.total <= t.total,
  );

  console.log("\nDrill-down");
  got = await drill("state=breached");
  check("state=breached has the breach, not the 10-hour incident", got.includes(String(breachId)) && !got.includes(String(withinId)));
  got = await drill(`team=none&priority=${priority}&org=${orgId}&type=incident`);
  check(
    "team=none + priority + customer + incidents has our three incidents, not the request",
    [withinId, breachId, riskId].every((id) => got.includes(String(id))) && !got.includes(String(requestId)),
  );
  got = await drill("type=request&state=none");
  check("type=request&state=none has the request", got.includes(String(requestId)));

  console.log("\nValidation");
  for (const qs of ["type=problem", "state=late", "team=x", "priority=7", "org=1%20OR%201"]) {
    res = await request("GET", `/api/sla/tickets?${qs}`);
    check(`refused: ${qs}`, res.status === 400, `${res.status}`);
  }
}

async function cleanup() {
  console.log("\nCleanup");
  for (const [className, id] of created.reverse()) {
    const res = await request("DELETE", `/api/objects/${className}/${id}?comment=${encodeURIComponent(TAG)}`);
    if (res.status !== 200 && res.status !== 204) {
      console.log(`  could not delete ${className} ${id}: ${res.status} ${res.text.slice(0, 160)}`);
    }
  }
  console.log(`  deleted what this run created (${created.length} objects)`);
}

try {
  await main();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.log(`\nABORTED: ${error.message}`);
} finally {
  await cleanup().catch((e) => console.log(`  cleanup failed: ${e.message}`));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
