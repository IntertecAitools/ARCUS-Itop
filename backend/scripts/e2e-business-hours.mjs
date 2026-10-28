/**
 * Business hours end to end, against a running BFF and the local iTop.
 *
 * On an iTop WITHOUT Combodo's business-hours modules it checks that the
 * admin API says so (`available: false`, writes refused with 409) and that
 * the SLA dashboard still answers.
 *
 * WITH them (combodo-sla-computation + combodo-coverage-windows-computation;
 * backend/README.md, "Business hours") it signs in as an administrator and:
 *   - refuses malformed and overlapping open hours (400);
 *   - creates a coverage window open only on one weekday two days ahead,
 *     09:00–17:00, a 60-minute TTO SLT on a service of a customer contract,
 *     and puts that contract service in the window;
 *   - opens an incident and expects iTop's TTO deadline at 10:00 on that
 *     day (working time), not an hour from now;
 *   - adds a holiday on that day, opens a second incident and expects the
 *     deadline a week later;
 *   - expects the SLA dashboard to count the first incident in working
 *     time (0% used, nothing of the window has passed);
 *   - deletes the window and expects the contract service kept, back on 24x7.
 * Everything it creates in iTop is deleted at the end, pass or fail.
 *
 *   npm run e2e:business-hours                          BFF on http://127.0.0.1:4040
 *
 * The account: "sla" in backend/e2e.local.json, as for e2e:sla; it must be
 * an administrator (the API is under /api/admin).
 */
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4040");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5213";
const TZ = process.env.E2E_ITOP_TZ ?? "Europe/Paris";
const STAMP = new Date().toISOString().slice(0, 19);
const TAG = `e2e-bh ${STAMP}`;

if (!fs.existsSync(CONFIG)) {
  console.error(`No ${CONFIG.pathname}: add { "sla": { "login", "password" } } (see e2e-sla.mjs).`);
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

const BH = "/api/admin/business-hours";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** A day in iTop's time zone, `days` from today: { day: "YYYY-MM-DD", weekday }. */
function dayAhead(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { day, weekday: WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] };
}

/** The wall-clock "YYYY-MM-DD HH:MM" of an instant in iTop's time zone. */
function wall(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

async function withoutExtension() {
  console.log("\nThis iTop has no business-hours modules");
  let res = await request("POST", `${BH}/holidays`, { name: `${TAG} holiday`, date: "2030-12-25" });
  check("writes are refused with 409", res.status === 409, `${res.status} ${res.text.slice(0, 200)}`);
  check("and say what to install", /combodo-sla-computation/.test(res.text));
  res = await request("GET", "/api/sla/dashboard");
  check("the SLA dashboard still answers (24x7)", res.status === 200, `${res.status}`);
}

async function withExtension(orgId) {
  console.log("\nValidation");
  const bad = [
    [
      "overlapping hours",
      {
        name: `${TAG} x`,
        intervals: [
          { weekday: "monday", start: "09:00", end: "13:00" },
          { weekday: "monday", start: "12:00", end: "17:00" },
        ],
      },
    ],
    ["end before start", { name: `${TAG} x`, intervals: [{ weekday: "monday", start: "17:00", end: "09:00" }] }],
    ["no hours", { name: `${TAG} x`, intervals: [] }],
  ];
  for (const [what, body] of bad) {
    const res = await request("POST", `${BH}/coverage-windows`, body);
    check(`refused: ${what}`, res.status === 400, `${res.status} ${res.text.slice(0, 160)}`);
  }

  console.log("\nSetup");
  const open = dayAhead(2);
  const callerId = await create("Person", { name: "Caller", first_name: `E2E BH ${Date.now().toString(36)}`, org_id: orgId });
  const ticket = (title, serviceId) => ({
    org_id: orgId,
    caller_id: callerId,
    title: `${TAG} ${title}`,
    description: "<p>Opened by the business-hours e2e script</p>",
    impact: "3",
    urgency: "3",
    ...(serviceId ? { service_id: serviceId } : {}),
  });
  const probeId = await create("Incident", ticket("priority probe"));
  const priority = String((await getFields("Incident", probeId, "priority")).priority ?? "");

  let res = await request("POST", `${BH}/coverage-windows`, {
    name: `${TAG} ${open.weekday} only`,
    description: "e2e",
    intervals: [{ weekday: open.weekday, start: "09:00", end: "17:00" }],
  });
  check("coverage window created", res.status === 201, `${res.status} ${res.text.slice(0, 200)}`);
  const windowId = res.json?.id;
  if (windowId) created.push(["CoverageWindow", Number(windowId)]);

  res = await request("POST", `${BH}/calendars`, { name: `${TAG} calendar` });
  check("holiday calendar created", res.status === 201, `${res.status} ${res.text.slice(0, 200)}`);
  const calendarId = res.json?.id;
  if (calendarId) created.push(["HolidayCalendar", Number(calendarId)]);

  const serviceId = await create("Service", { name: `${TAG} service`, org_id: orgId });
  const slaId = await create("SLA", { name: `${TAG} SLA`, org_id: orgId });
  const sltId = await create("SLT", { name: `${TAG} tto`, metric: "tto", priority, request_type: "incident", value: 60, unit: "minutes" });
  await link("SLA", slaId, "slts_list", sltId);
  const contractId = await create("CustomerContract", { name: `${TAG} contract`, org_id: orgId, provider_id: orgId });
  await link("CustomerContract", contractId, "services_list", serviceId, { sla_id: slaId });

  res = await request("GET", BH);
  const assignment = res.json?.assignments?.find((a) => a.serviceId === String(serviceId) && a.contractId === String(contractId));
  check("the contract service is listed, on 24x7", assignment?.coverageWindowId === "", JSON.stringify(assignment));
  res = await request("PUT", `${BH}/assignments/${assignment?.id}`, { coverageWindowId: windowId });
  check("contract service put in the window", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
  res = await request("GET", BH);
  const win = res.json?.coverageWindows?.find((w) => w.id === windowId);
  check("the window shows its hours and its use", win?.usedBy === 1 && win.intervals.length === 1, JSON.stringify(win));

  console.log(`\nWorking time (open only ${open.weekday} ${open.day}, 09:00–17:00)`);
  const firstId = await create("Incident", ticket("in the window", serviceId));
  const first = await getFields("Incident", firstId, "ref,tto_escalation_deadline");
  const firstAt = first.tto_escalation_deadline ? wall(first.tto_escalation_deadline) : "none";
  check(`iTop's TTO deadline is ${open.day} 10:00, an hour into the window`, firstAt === `${open.day} 10:00`, firstAt);

  res = await request("GET", `/api/sla/tickets?org=${orgId}&type=incident`);
  const row = res.json?.items?.find((t) => t.id === String(firstId));
  check(
    "the SLA dashboard counts it in working time: 0% used, within",
    row?.tto.state === "within" && row.tto.percentUsed === 0 && row.tto.goalSeconds === 3600,
    JSON.stringify(row?.tto),
  );

  res = await request("POST", `${BH}/holidays`, { name: `${TAG} closed`, date: open.day, calendarId });
  check("holiday added on that day", res.status === 201, `${res.status} ${res.text.slice(0, 200)}`);
  if (res.json?.id) created.push(["Holiday", Number(res.json.id)]);
  const nextWeek = dayAhead(9).day;
  const secondId = await create("Incident", ticket("after the holiday", serviceId));
  const second = await getFields("Incident", secondId, "tto_escalation_deadline");
  const secondAt = second.tto_escalation_deadline ? wall(second.tto_escalation_deadline) : "none";
  check(`with the holiday the deadline moves to ${nextWeek} 10:00`, secondAt === `${nextWeek} 10:00`, secondAt);
  res = await request("GET", BH);
  check(
    "the holiday is listed in its calendar",
    res.json?.holidays?.some((h) => h.date === open.day && h.calendarId === calendarId) &&
      res.json?.calendars?.find((c) => c.id === calendarId)?.holidayCount === 1,
  );

  console.log("\nDeleting the window");
  res = await request("DELETE", `${BH}/coverage-windows/${windowId}`);
  check("deleted, its contract service detached first", res.status === 200 && res.json?.detached === 1, `${res.status} ${res.text.slice(0, 200)}`);
  if (res.status === 200) created.splice(created.findIndex(([c]) => c === "CoverageWindow"), 1);
  res = await request("GET", BH);
  const kept = res.json?.assignments?.find((a) => a.id === assignment?.id);
  check("the contract service is still on the contract, back on 24x7", kept?.coverageWindowId === "", JSON.stringify(kept));
}

async function main() {
  const user = await signIn();
  const orgId = Number(user.orgId || 1);
  const res = await request("GET", BH);
  check("business hours answer 200", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
  if (res.json?.available) await withExtension(orgId);
  else await withoutExtension();
}

async function cleanup() {
  console.log("\nCleanup");
  for (const [className, id] of created.reverse()) {
    const path =
      className === "CoverageWindow"
        ? `${BH}/coverage-windows/${id}`
        : className === "HolidayCalendar"
          ? `${BH}/calendars/${id}`
          : className === "Holiday"
            ? `${BH}/holidays/${id}`
            : `/api/objects/${className}/${id}?comment=${encodeURIComponent(TAG)}`;
    const res = await request("DELETE", path);
    if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
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
