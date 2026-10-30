/**
 * Ticket handling end to end, against a BFF and an iTop with the
 * arcus-ticket-dispatch extension:
 *
 *   - priority override: a Support Agent overrides with a reason; iTop then
 *     computes that priority itself, and the reason is in the private log;
 *   - duplicates: suggested for a ticket being written and for one being
 *     triaged; marked (from Dispatched), linked through iTop's parent field,
 *     resolved with a note; refused to a Service Desk Agent;
 *   - cancel: staff (from Dispatched) and the requester from the portal;
 *     the ticket ends Closed with the reason;
 *   - worklogs: two agents log time, totals per ticket and per agent, only
 *     the author removes an entry;
 *   - drafts: saved, listed, resumed and deleted, each user's own.
 *
 * Tickets, worklog entries and drafts it makes are removed at the end, pass
 * or fail. It reuses the accounts e2e:dispatch keeps (backend/e2e.local.json,
 * "dispatch"; run that once first) and makes one portal account the first
 * time ("handling" in the same file).
 *
 *   npm run e2e:ticket-handling                         BFF on http://127.0.0.1:4070
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:ticket-handling
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const ENV = new URL("../.env", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4070");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5243";
const TAG = `e2e-handling ${new Date().toISOString().slice(0, 19)}`;

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
} catch {
  config = {};
}
const saveConfig = () => fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

let passed = 0;
const failures = [];
/** [class, id], deleted in reverse order at the end. */
const created = [];
/** [role, entry id] and [role, draft id], removed at the end. */
const worklogs = [];
const drafts = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------------- *
 * Bootstrap, once, in iTop as the service account
 * ------------------------------------------------------------------------- */

function readEnv() {
  const env = {};
  for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function itop(operation, params) {
  const env = readEnv();
  const body = new URLSearchParams({
    version: env.ITOP_REST_VERSION || "1.4",
    auth_user: env.ITOP_USER,
    auth_pwd: env.ITOP_PASSWORD,
    json_data: JSON.stringify({ operation, ...params }),
  });
  const res = await fetch(`${(env.ITOP_BASE_URL || "http://localhost:8080").replace(/\/+$/, "")}/webservices/rest.php`, {
    method: "POST",
    body,
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`iTop ${operation}: ${json.code} ${json.message}`);
  return Object.values(json.objects ?? {});
}

const make = async (cls, fields) =>
  Number((await itop("core/create", { class: cls, fields, comment: "e2e-handling setup", output_fields: "id" }))[0].key);

async function bootstrap() {
  const profiles = await itop("core/get", { class: "URP_Profiles", key: "SELECT URP_Profiles WHERE name = 'Portal user'", output_fields: "name" });
  const login = "e2e.handling.portal";
  const personId = await make("Person", {
    name: "portal",
    first_name: "E2E handling",
    org_id: config.dispatch.orgId,
    email: `${login}@example.test`,
  });
  const password = `E2e-${crypto.randomBytes(9).toString("base64url")}!9a`;
  await make("UserLocal", {
    login,
    password,
    contactid: personId,
    language: "EN US",
    profile_list: [{ profileid: Number(profiles[0].key) }],
  });
  config.handling = { portal: { login, password, personId } };
  saveConfig();
  console.log(`  created portal account ${login} (person ${personId})`);
}

/* ------------------------------------------------------------------------- *
 * The BFF, one cookie per account
 * ------------------------------------------------------------------------- */

const sessions = {};

function request(role, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const cookie = sessions[role];
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
          if (set) sessions[role] = String(Array.isArray(set) ? set[0] : set).split(";")[0];
          resolve({ status: res.statusCode, text, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const code = (secret) => totpAt(secret, timeStep(Date.now()));

function accountOf(role) {
  return role === "portal" ? config.handling.portal : config.dispatch.accounts[role];
}

/** Password, then (staff) the authenticator code. */
async function signIn(role) {
  const account = accountOf(role);
  const login = await request(role, "POST", "/api/auth/login", { login: account.login, password: account.password });
  if (login.status !== 200) throw new Error(`sign-in ${account.login}: ${login.status} ${login.text.slice(0, 200)}`);
  if (login.json.user) return login.json.user;
  if (login.json.mfa?.step === "enrol") {
    const enrol = await request(role, "GET", "/api/auth/mfa/enrol");
    account.totpSecret = enrol.json.secret;
    const done = await request(role, "POST", "/api/auth/mfa/enrol", { code: code(account.totpSecret) });
    if (done.status !== 200) throw new Error(`MFA enrolment ${account.login}: ${done.status} ${done.text.slice(0, 200)}`);
    saveConfig();
    return done.json.user;
  }
  if (!account.totpSecret) throw new Error(`${account.login} is enrolled in MFA but e2e.local.json has no totpSecret`);
  for (const attempt of [0, 1]) {
    if (attempt) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
    const verify = await request(role, "POST", "/api/auth/mfa/verify", { code: code(account.totpSecret) });
    if (verify.status === 200) return verify.json.user;
    if (attempt) throw new Error(`MFA code refused for ${account.login}: ${verify.status} ${verify.text.slice(0, 200)}`);
  }
}

const message = (res) => res.json?.error?.message ?? res.text.slice(0, 200);

async function newIncident(title, extra = {}) {
  const res = await request("desk", "POST", "/api/incidents", {
    title: `${TAG} ${title}`,
    description: "ticket handling e2e",
    callerId: String(config.dispatch.accounts.desk.personId),
    organizationId: String(config.dispatch.orgId),
    impact: "2",
    urgency: "3",
    ...extra,
  });
  if (res.status !== 201) throw new Error(`create incident: ${res.status} ${res.text.slice(0, 300)}`);
  created.push(["Incident", res.json.id]);
  return res.json;
}

async function newRequest(title) {
  const res = await request("desk", "POST", "/api/objects/UserRequest", {
    fields: {
      org_id: config.dispatch.orgId,
      caller_id: config.dispatch.accounts.desk.personId,
      title: `${TAG} ${title}`,
      description: "<p>ticket handling e2e</p>",
      request_type: "service_request",
      impact: "2",
      urgency: "3",
    },
    comment: TAG,
  });
  if (res.status !== 201) throw new Error(`create request: ${res.status} ${res.text.slice(0, 300)}`);
  created.push(["UserRequest", res.json.object.id]);
  return { id: res.json.object.id, ref: res.json.object.fields.ref, status: res.json.object.fields.status };
}

/** Sends a new ticket to team A unless an assignment rule already did. */
async function ensureDispatched(cls, id) {
  const path = `/api/objects/${cls}/${id}`;
  const now = await request("desk", "GET", path);
  if (now.json?.fields?.status === "dispatched") return "dispatched";
  const res = await request("desk", "POST", `${path}/stimulus`, {
    stimulus: "ev_dispatch",
    fields: { team_id: config.dispatch.teams.a },
    comment: TAG,
  });
  return res.json?.fields?.status ?? `${res.status} ${message(res)}`;
}

const handling = (role, cls, id) => request(role, "GET", `/api/ticket-handling/${cls}/${id}`);

/* ------------------------------------------------------------------------- *
 * The journeys
 * ------------------------------------------------------------------------- */

async function priority() {
  console.log("\nPriority override");
  const incident = await newIncident("priority override");
  check("a new incident with impact 2, urgency 3 is Medium", incident.priority === "medium", incident.priority);

  const noReason = await request("a1", "PUT", `/api/ticket-handling/Incident/${incident.id}/priority`, { priority: "critical", reason: "" });
  check("an override without a reason is a 400", noReason.status === 400, `${noReason.status}`);

  const done = await request("a1", "PUT", `/api/ticket-handling/Incident/${incident.id}/priority`, {
    priority: "critical",
    reason: "Whole sales floor affected",
  });
  check(
    "a Support Agent overrides it to Critical, with the record shown",
    done.status === 200 && done.json.priority === "critical" && done.json.override?.active === true && done.json.override.from === "medium",
    `${done.status} ${message(done)}`,
  );
  const raw = await request("a1", "GET", `/api/objects/Incident/${incident.id}`);
  check(
    "iTop itself now has priority 1 (urgency moved to 1, impact kept)",
    String(raw.json?.fields?.priority) === "1" && String(raw.json.fields.urgency) === "1" && String(raw.json.fields.impact) === "2",
    `${raw.json?.fields?.priority} ${raw.json?.fields?.urgency} ${raw.json?.fields?.impact}`,
  );
  const privateLog = JSON.stringify(raw.json?.fields?.private_log ?? "");
  check("the reason is in the private log", /Priority overridden from Medium to Critical .*Whole sales floor affected/.test(privateLog), privateLog.slice(0, 300));

  const edit = await request("a1", "PATCH", `/api/incidents/${incident.id}`, { urgency: "3" });
  const after = await handling("a1", "Incident", incident.id);
  check(
    "reassessing urgency afterwards leaves the override on record, no longer in force",
    edit.status === 200 && after.json?.override?.active === false && after.json.priority === "medium",
    `${edit.status} ${message(edit)} ${JSON.stringify(after.json?.override)}`,
  );
}

async function duplicates() {
  console.log("\nDuplicates");
  const original = await newIncident("VPN outage on floor 3");
  const dup = await newIncident("Floor 3 VPN outage again");
  check("the duplicate is Dispatched to team A", (await ensureDispatched("Incident", dup.id)) === "dispatched");

  const typing = await request("desk", "POST", "/api/ticket-handling/duplicates/suggest", {
    class: "Incident",
    title: "vpn outage floor 3",
    orgId: config.dispatch.orgId,
    callerId: config.dispatch.accounts.desk.personId,
  });
  const fromForm = typing.json?.items?.find((i) => i.id === original.id || String(i.id) === String(original.id));
  check(
    "while writing a new incident, the open one is suggested (same caller, similar title)",
    typing.status === 200 && fromForm && fromForm.reasons.includes("same caller") && fromForm.reasons.includes("similar title"),
    `${typing.status} ${JSON.stringify(typing.json?.items?.map((i) => [i.ref, i.reasons]))}`,
  );

  const triage = await request("a1", "GET", `/api/ticket-handling/Incident/${dup.id}/duplicates/suggestions`);
  const refs = (triage.json?.items ?? []).map((i) => i.ref);
  check("triaging the second, the first is suggested and itself is not", refs.includes(original.ref) && !refs.includes(dup.ref), JSON.stringify(refs));

  const desk = await request("desk", "POST", `/api/ticket-handling/Incident/${dup.id}/duplicate`, { originalClass: "Incident", originalId: Number(original.id) });
  check("a Service Desk Agent may not mark it (403: resolving needs Support Agent)", desk.status === 403, `${desk.status} ${message(desk)}`);

  const marked = await request("a1", "POST", `/api/ticket-handling/Incident/${dup.id}/duplicate`, {
    originalClass: "Incident",
    originalId: Number(original.id),
    note: "same outage",
  });
  check(
    "a Support Agent marks it from Dispatched: resolved, pointing to the original",
    marked.status === 200 && marked.json.open === false && marked.json.duplicateOf?.ref === original.ref,
    `${marked.status} ${message(marked)}`,
  );
  const row = await request("a1", "GET", `/api/objects/Incident/${dup.id}`);
  check(
    "iTop has it resolved, parent_incident_id set, the note in the solution",
    row.json?.fields?.status === "resolved" &&
      String(row.json.fields.parent_incident_id) === String(original.id) &&
      /Duplicate of .*same outage/.test(String(row.json.fields.solution)),
    `${row.json?.fields?.status} ${row.json?.fields?.parent_incident_id} ${row.json?.fields?.solution}`,
  );
  const orig = await handling("a1", "Incident", original.id);
  check("the original lists it among its duplicates", (orig.json?.duplicates ?? []).some((d) => d.ref === dup.ref), JSON.stringify(orig.json?.duplicates));

  const req = await newRequest("VPN outage request");
  const reqDup = await request("a1", "POST", `/api/ticket-handling/UserRequest/${req.id}/duplicate`, {
    originalClass: "Incident",
    originalId: Number(original.id),
  });
  const reqRow = await request("a1", "GET", `/api/objects/UserRequest/${req.id}`);
  check(
    "a request can be a duplicate of an incident (parent_incident_id)",
    reqDup.status === 200 && String(reqRow.json?.fields?.parent_incident_id) === String(original.id),
    `${reqDup.status} ${message(reqDup)}`,
  );
  const other = await newRequest("unrelated request");
  const wrongWay = await request("a1", "POST", `/api/ticket-handling/Incident/${original.id}/duplicate`, {
    originalClass: "UserRequest",
    originalId: Number(other.id),
  });
  check("an incident cannot be a duplicate of a request (400)", wrongWay.status === 400, `${wrongWay.status}`);
  const chained = await request("a1", "POST", `/api/ticket-handling/UserRequest/${other.id}/duplicate`, {
    originalClass: "Incident",
    originalId: Number(dup.id),
  });
  check("pointing at a duplicate is refused, naming its original (400)", chained.status === 400 && message(chained).includes(original.ref), message(chained));
}

async function cancel() {
  console.log("\nCancel");
  const incident = await newIncident("cancel me");
  check("the incident is Dispatched", (await ensureDispatched("Incident", incident.id)) === "dispatched");
  const desk = await request("desk", "POST", `/api/ticket-handling/Incident/${incident.id}/cancel`, { reason: "Raised twice" });
  check("a Service Desk Agent may not cancel (403)", desk.status === 403, `${desk.status} ${message(desk)}`);
  const done = await request("a1", "POST", `/api/ticket-handling/Incident/${incident.id}/cancel`, { reason: "Raised twice" });
  check(
    "a Support Agent cancels it from Dispatched, with the reason",
    done.status === 200 && done.json.open === false && done.json.cancelled?.reason === "Raised twice",
    `${done.status} ${message(done)}`,
  );
  const row = await request("a1", "GET", `/api/objects/Incident/${incident.id}`);
  check("iTop has it Closed, resolution code other", row.json?.fields?.status === "closed" && row.json.fields.resolution_code === "other", `${row.json?.fields?.status}`);
  const again = await request("a1", "POST", `/api/ticket-handling/Incident/${incident.id}/cancel`, { reason: "again" });
  check("cancelling it again is a 400", again.status === 400, `${again.status}`);

  // The requester, from the portal.
  const raised = await request("portal", "POST", "/api/portal/requests", { title: `${TAG} portal cancel`, description: "please ignore" });
  if (raised.status === 201) created.push(["UserRequest", raised.json.id]);
  check("the requester raises a request in the portal", raised.status === 201, `${raised.status} ${message(raised)}`);
  check("the portal offers Cancel on it", raised.json?.actions?.includes("cancel"), JSON.stringify(raised.json?.actions));
  const noReason = await request("portal", "POST", `/api/portal/requests/${raised.json?.id}/cancel`, { reason: "" });
  check("cancelling without a reason is a 400", noReason.status === 400, `${noReason.status}`);
  const cancelled = await request("portal", "POST", `/api/portal/requests/${raised.json?.id}/cancel`, { reason: "Sorted it myself" });
  check(
    "the requester cancels it: Closed, the reason in the solution, no actions left",
    cancelled.status === 200 && cancelled.json.status === "closed" && /Sorted it myself/.test(cancelled.json.solution) && cancelled.json.actions.length === 0,
    `${cancelled.status} ${message(cancelled)} ${cancelled.json?.status}`,
  );
  const staffView = await handling("a1", "UserRequest", raised.json?.id);
  check("staff see it was cancelled by the requester", /\(requester\)/.test(staffView.json?.cancelled?.by ?? ""), JSON.stringify(staffView.json?.cancelled));
  const otherTicket = await request("portal", "POST", `/api/portal/requests/${incident.id}/cancel`, { reason: "not mine" });
  check("the requester cannot cancel someone else's ticket (404)", otherTicket.status === 404, `${otherTicket.status}`);
}

async function worklog() {
  console.log("\nWorklogs");
  const incident = await newIncident("worklog");
  const first = await request("a1", "POST", `/api/ticket-handling/Incident/${incident.id}/worklogs`, { minutes: 30, note: "Diagnosed" });
  const second = await request("a2", "POST", `/api/ticket-handling/Incident/${incident.id}/worklogs`, { minutes: 45, note: "Fixed the tunnel" });
  for (const [role, res] of [["a1", first], ["a2", second]]) {
    const mine = res.json?.entries?.find((e) => e.mine && e.agent.userId);
    if (mine) worklogs.push([role, mine.id]);
  }
  check("two agents log time", first.status === 201 && second.status === 201, `${first.status} ${second.status} ${message(second)}`);
  const log = await request("a1", "GET", `/api/ticket-handling/Incident/${incident.id}/worklogs`);
  check(
    "the ticket totals 75 minutes, 30 and 45 per agent",
    log.json?.totalMinutes === 75 && JSON.stringify(log.json.byAgent.map((a) => a.minutes).sort()) === JSON.stringify([30, 45]),
    JSON.stringify(log.json?.byAgent),
  );
  const bad = await request("a1", "POST", `/api/ticket-handling/Incident/${incident.id}/worklogs`, { minutes: 0, note: "x" });
  check("zero minutes is a 400", bad.status === 400, `${bad.status}`);
  const a2Entry = log.json?.entries?.find((e) => e.minutes === 45);
  const notMine = await request("a1", "DELETE", `/api/ticket-handling/worklogs/${a2Entry?.id}`);
  check("an agent cannot remove another's entry (403)", notMine.status === 403, `${notMine.status}`);
  const summary = await handling("a1", "Incident", incident.id);
  check("the ticket summary carries the total", summary.json?.worklog?.totalMinutes === 75, JSON.stringify(summary.json?.worklog));
  const me = (await request("a1", "GET", "/api/auth/me")).json?.user ?? {};
  const report = await request("a1", "GET", `/api/ticket-handling/worklogs/report${me.id ? `?userId=${me.id}` : ""}`);
  check(
    "the report has the ticket, and the agent's own time",
    report.status === 200 && report.json.byTicket.some((t) => t.ticketRef === incident.ref) && report.json.byAgent.every((a) => !me.id || a.userId === me.id),
    `${report.status} ${message(report)}`,
  );
  const removed = await request("a2", "DELETE", `/api/ticket-handling/worklogs/${a2Entry?.id}`);
  check("the author removes their own entry", removed.status === 200 && removed.json.totalMinutes === 30, `${removed.status} ${message(removed)}`);
  const i = worklogs.findIndex(([, id]) => id === a2Entry?.id);
  if (i >= 0) worklogs.splice(i, 1);
}

async function draftsJourney() {
  console.log("\nDrafts");
  const saved = await request("a1", "POST", "/api/me/drafts", { kind: "incident", data: { title: `${TAG} half done`, impact: "2" } });
  if (saved.status === 201) drafts.push(["a1", saved.json.id]);
  check("an agent saves a half-filled incident", saved.status === 201 && saved.json.title.endsWith("half done"), `${saved.status} ${message(saved)}`);
  const list = await request("a1", "GET", "/api/me/drafts");
  check("it is in their drafts", (list.json?.items ?? []).some((d) => d.id === saved.json?.id), JSON.stringify(list.json?.items?.length));
  const other = await request("a2", "GET", `/api/me/drafts/${saved.json?.id}`);
  check("another agent cannot open it (404)", other.status === 404, `${other.status}`);
  const resumed = await request("a1", "PUT", `/api/me/drafts/${saved.json?.id}`, { kind: "incident", data: { title: `${TAG} nearly done`, impact: "1" } });
  const read = await request("a1", "GET", `/api/me/drafts/${saved.json?.id}`);
  check("resumed and saved again", resumed.status === 200 && read.json?.data?.impact === "1", `${resumed.status} ${message(resumed)}`);

  const portal = await request("portal", "POST", "/api/me/drafts", { kind: "portal-request", data: { title: `${TAG} portal draft` } });
  if (portal.status === 201) drafts.push(["portal", portal.json.id]);
  check("an end user saves the portal request form", portal.status === 201, `${portal.status} ${message(portal)}`);
  const wrong = await request("portal", "POST", "/api/me/drafts", { kind: "incident", data: {} });
  check("but not the staff incident form (403)", wrong.status === 403, `${wrong.status}`);

  const deleted = await request("a1", "DELETE", `/api/me/drafts/${saved.json?.id}`);
  check("a draft is deleted", deleted.status === 204, `${deleted.status}`);
  if (deleted.status === 204) drafts.splice(drafts.findIndex(([, id]) => id === saved.json?.id), 1);
}

async function main() {
  console.log("Accounts");
  if (!config.dispatch) throw new Error("run npm run e2e:dispatch once first: its accounts are reused here");
  if (!config.handling) await bootstrap();
  for (const role of ["admin", "desk", "a1", "a2", "portal"]) {
    const user = await signIn(role);
    check(`${role} signed in (${accountOf(role).login})`, Boolean(user));
  }
  await priority();
  await duplicates();
  await cancel();
  await worklog();
  await draftsJourney();
}

async function cleanup() {
  for (const [role, id] of worklogs) await request(role, "DELETE", `/api/ticket-handling/worklogs/${id}`);
  for (const [role, id] of drafts) await request(role, "DELETE", `/api/me/drafts/${id}`);
  for (const [cls, id] of created.reverse()) {
    const res = await request("admin", "DELETE", `/api/objects/${cls}/${id}?comment=${encodeURIComponent(TAG)}`);
    if (res.status !== 200) console.log(`  (could not delete ${cls} ${id}: ${res.status} ${res.text.slice(0, 120)})`);
  }
}

try {
  await main();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.log(`  ABORT ${error.message}`);
} finally {
  if (sessions.admin) await cleanup();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
