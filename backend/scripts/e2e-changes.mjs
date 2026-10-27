/**
 * Change management end to end, against a running BFF and iTop with the
 * arcus-change-cab extension. Each step runs as the iTop profile that owns it:
 *
 *   - a Change Supervisor raises a normal change, validates and assigns it
 *     (an Implementor may not validate);
 *   - a Change Implementor tries to Plan: refused naming every missing plan,
 *     then only the rollback plan; plans with the rollback plan given in the
 *     action itself;
 *   - the change is in the "Awaiting CAB" queue; Approve through the generic
 *     action is refused (the CAB decides), an Implementor may not record a
 *     decision;
 *   - a Change Approver defers it (still waiting), then approves it with
 *     conditions: iTop's approval date and comment are set, the history
 *     keeps both decisions, the queue no longer lists it; the Implementor
 *     implements it;
 *   - an emergency change is not approved: a rejection needs notes, which
 *     become iTop's reason;
 *   - a routine change plans with its implementation plan only (no rollback
 *     plan: iTop's own "mandatory" is lifted by the extension); with an
 *     administrator's rule "test plan required to implement", Implement is
 *     refused until it is written; the rules are put back afterwards;
 *   - plan rules are administrators' only.
 * The changes it creates are deleted at the end, pass or fail. Accounts,
 * people and the team it needs are created once and kept for the next run.
 *
 *   npm run e2e:changes                              BFF on http://127.0.0.1:4020
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:changes
 *
 * MFA stays on. The accounts' logins, passwords and TOTP secrets live in
 * backend/e2e.local.json (git-ignored), under "changes". On the first run the
 * script creates them in iTop, as the BFF's own service account (ITOP_* in
 * backend/.env), and enrols each in MFA. Setting up: backend/README.md,
 * "Changes".
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const ENV = new URL("../.env", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4020");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5193";
const TAG = `e2e-changes ${new Date().toISOString().slice(0, 19)}`;

const ROLES = {
  admin: ["Administrator"],
  supervisor: ["Change Supervisor"],
  implementor: ["Change Implementor"],
  approver: ["Change Approver"],
};

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
 * Bootstrap: the accounts, made once in iTop as the service account
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

const strongPassword = () => `E2e-${crypto.randomBytes(9).toString("base64url")}!9a`;

async function bootstrap() {
  const orgs = await itop("core/get", { class: "Organization", key: "SELECT Organization", output_fields: "name", limit: 1 });
  const orgId = Number(orgs[0].key);
  const profiles = await itop("core/get", { class: "URP_Profiles", key: "SELECT URP_Profiles", output_fields: "name" });
  const profileId = (name) => Number(profiles.find((p) => p.fields.name === name)?.key);

  const team = await itop("core/create", {
    class: "Team",
    fields: { name: "E2E change team", org_id: orgId },
    comment: "e2e-changes setup",
    output_fields: "id",
  });
  const out = { orgId, teamId: Number(team[0].key), accounts: {} };
  for (const [role, names] of Object.entries(ROLES)) {
    const login = `e2e.chg.${role}`;
    const person = await itop("core/create", {
      class: "Person",
      fields: { name: role, first_name: "E2E change", org_id: orgId, email: `${login}@example.test` },
      comment: "e2e-changes setup",
      output_fields: "id",
    });
    const personId = Number(person[0].key);
    await itop("core/create", {
      class: "lnkPersonToTeam",
      fields: { person_id: personId, team_id: out.teamId },
      comment: "e2e-changes setup",
      output_fields: "id",
    });
    const password = strongPassword();
    await itop("core/create", {
      class: "UserLocal",
      fields: {
        login,
        password,
        contactid: personId,
        language: "EN US",
        profile_list: [...names, "REST Services User"].map((n) => ({ profileid: profileId(n) })),
      },
      comment: "e2e-changes setup",
      output_fields: "id",
    });
    out.accounts[role] = { login, password, personId, totpSecret: "" };
  }
  config.changes = out;
  saveConfig();
  console.log(`  created accounts ${Object.values(out.accounts).map((a) => a.login).join(", ")} and team ${out.teamId}`);
}

/* ------------------------------------------------------------------------- *
 * Talking to the BFF, one cookie per account
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

/** Password, then the MFA step: enrols (saving the secret) or answers with a code. */
async function signIn(role) {
  const account = config.changes.accounts[role];
  const login = await request(role, "POST", "/api/auth/login", { login: account.login, password: account.password });
  if (login.status !== 200) throw new Error(`sign-in ${account.login}: ${login.status} ${login.text.slice(0, 200)}`);
  if (login.json.user) throw new Error("signed in without MFA: this BFF has MFA off, which this script does not expect");

  if (login.json.mfa?.step === "enrol") {
    const enrol = await request(role, "GET", "/api/auth/mfa/enrol");
    account.totpSecret = enrol.json.secret;
    const done = await request(role, "POST", "/api/auth/mfa/enrol", { code: code(account.totpSecret) });
    if (done.status !== 200) throw new Error(`MFA enrolment ${account.login}: ${done.status} ${done.text.slice(0, 200)}`);
    saveConfig();
    return done.json.user;
  }
  if (!account.totpSecret) throw new Error(`${account.login} is enrolled in MFA but e2e.local.json has no totpSecret`);
  // A code works once: if the last run used this 30-second step, wait for the next.
  for (const attempt of [0, 1]) {
    if (attempt) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
    const verify = await request(role, "POST", "/api/auth/mfa/verify", { code: code(account.totpSecret) });
    if (verify.status === 200) return verify.json.user;
    if (attempt) throw new Error(`MFA code refused for ${account.login}: ${verify.status} ${verify.text.slice(0, 200)}`);
  }
}

async function create(role, className, fields) {
  const res = await request(role, "POST", `/api/objects/${className}`, { fields, comment: TAG });
  if (res.status !== 201) throw new Error(`create ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  created.push([className, res.json.object.id]);
  return res.json.object.id;
}

const act = (role, cls, id, stimulus, fields = {}) =>
  request(role, "POST", `/api/objects/${cls}/${id}/stimulus`, { stimulus, fields, comment: TAG });
const governance = (role, id) => request(role, "GET", `/api/changes/${id}/governance`);
const plans = (role, id, body) => request(role, "PUT", `/api/changes/${id}/plans`, body);
const decide = (role, id, body) => request(role, "POST", `/api/changes/${id}/cab-decisions`, body);
const reason = (res) => res.json?.error?.details?.reason;
const message = (res) => res.json?.error?.message ?? res.text.slice(0, 200);

const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

/** Raises a change and takes it to Assigned, as the supervisor. */
async function assignedChange(cls, title) {
  const { orgId, teamId, accounts } = config.changes;
  const id = await create("supervisor", cls, {
    org_id: orgId,
    title: `${TAG} ${title}`,
    description: `<p>${title}</p>`,
    caller_id: accounts.supervisor.personId,
  });
  const groups = { team_id: teamId, supervisor_group_id: teamId, manager_group_id: teamId };
  if (cls === "NormalChange") {
    const v = await act("supervisor", cls, id, "ev_validate", {
      ...groups,
      acceptance_date: new Date().toISOString(),
      acceptance_comment: "Accepted for CAB",
    });
    if (v.status !== 200) throw new Error(`validate: ${v.status} ${message(v)}`);
  }
  const a = await act("supervisor", cls, id, "ev_assign", {
    ...(cls === "NormalChange" ? {} : groups),
    agent_id: accounts.implementor.personId,
    supervisor_id: accounts.supervisor.personId,
    manager_id: accounts.approver.personId,
  });
  if (a.status !== 200) throw new Error(`assign ${cls}: ${a.status} ${message(a)}`);
  return id;
}

const schedule = (extra = {}) => ({
  start_date: inHours(48),
  end_date: inHours(50),
  impact: "Mail delayed for ten minutes",
  outage: "yes",
  ...extra,
});

async function main() {
  console.log("Accounts");
  if (!config.changes) await bootstrap();
  for (const role of Object.keys(ROLES)) {
    const user = await signIn(role);
    check(`${role} signed in with password and TOTP (${config.changes.accounts[role].login})`, Boolean(user));
  }

  console.log("\nRules");
  let res = await request("implementor", "GET", "/api/admin/change-rules");
  check("plan rules are administrators' only (403 for an implementor)", res.status === 403, `${res.status}`);
  res = await request("admin", "GET", "/api/admin/change-rules");
  check("administrator reads the rules", res.status === 200 && res.json.rules?.normal, res.text.slice(0, 200));
  const originalRules = res.json.rules;
  res = await request("admin", "PUT", "/api/admin/change-rules", { rules: res.json.defaults });
  check("rules set to the defaults for this run", res.status === 200, `${res.status}`);

  try {
    await normalChange();
    await emergencyChange();
    await routineChange();
  } finally {
    await request("admin", "PUT", "/api/admin/change-rules", { rules: originalRules });
  }
}

async function normalChange() {
  console.log("\nNormal change: supervisor validates and assigns");
  const { orgId, accounts } = config.changes;
  const probe = await create("supervisor", "NormalChange", {
    org_id: orgId,
    title: `${TAG} probe`,
    description: "<p>probe</p>",
    caller_id: accounts.supervisor.personId,
  });
  let res = await act("implementor", "NormalChange", probe, "ev_validate", {
    team_id: config.changes.teamId,
    supervisor_group_id: config.changes.teamId,
    manager_group_id: config.changes.teamId,
    acceptance_date: new Date().toISOString(),
    acceptance_comment: "x",
  });
  check("an Implementor may not validate (403: the BFF applies iTop's change grants)", res.status === 403 && reason(res) === "profile_not_allowed", `${res.status} ${message(res)}`);

  const id = await assignedChange("NormalChange", "upgrade the mail relay");
  res = await governance("implementor", id);
  check("governance reads, extension present", res.status === 200 && res.json.available === true, res.text.slice(0, 300));
  if (!res.json?.available) throw new Error("this iTop lacks arcus-change-cab: install it first (backend/README.md, \"Changes\")");
  check("status assigned, type normal, CAB required", res.json.status === "assigned" && res.json.type === "normal" && res.json.cab.required);

  console.log("\nPlans gate Plan");
  res = await act("implementor", "NormalChange", id, "ev_plan", schedule());
  check(
    "Plan refused naming every missing plan",
    res.status === 409 && reason(res) === "plans_missing" && /implementation plan, rollback plan and test plan/.test(message(res)),
    `${res.status} ${message(res)}`,
  );
  const implementation = 'Drain the queue\n2. Patch "mail-01" & restart <smtp>';
  res = await plans("implementor", id, { implementation, test: "Send a test mail through the relay" });
  check("implementor saves the implementation and test plans", res.status === 200 && res.json.plans.implementation === implementation, res.text.slice(0, 300));
  res = await act("implementor", "NormalChange", id, "ev_plan", schedule());
  check("Plan refused naming only the rollback plan", res.status === 409 && /Add the rollback plan before planning/.test(message(res)), `${res.status} ${message(res)}`);
  res = await act("implementor", "NormalChange", id, "ev_plan", schedule({ fallback: "Restore the VM snapshot" }));
  check("Plan applied with the rollback plan given in the action", res.status === 200 && res.json.fields?.status === "plannedscheduled", `${res.status} ${message(res)}`);

  console.log("\nAwaiting CAB");
  res = await request("approver", "GET", "/api/changes/cab");
  const item = res.json?.items?.find((i) => i.id === String(id));
  check("the change is in the CAB queue, plans complete", res.status === 200 && item && item.missingPlans.length === 0, res.text.slice(0, 300));
  res = await act("approver", "NormalChange", id, "ev_approve", { approval_date: new Date().toISOString(), approval_comment: "x" });
  check("Approve through the generic action is refused: the CAB decides", res.status === 409 && reason(res) === "cab_decision_required", `${res.status} ${message(res)}`);
  const meeting = new Date().toISOString();
  res = await decide("implementor", id, { meetingDate: meeting, attendees: ["Ann"], decision: "approved", conditions: "", notes: "" });
  check("an Implementor may not record a CAB decision (403)", res.status === 403, `${res.status} ${message(res)}`);

  console.log("\nCAB decisions (Change Approver)");
  res = await decide("approver", id, {
    meetingDate: meeting,
    attendees: ["Ann Ops", "Bo Security"],
    decision: "deferred",
    conditions: "",
    notes: "Needs the load-test results",
  });
  check("deferred: recorded, still waiting", res.status === 201 && res.json.status === "planned" && res.json.cab.awaiting && res.json.cab.decisions.length === 1, `${res.status} ${message(res)}`);
  res = await decide("approver", id, {
    meetingDate: meeting,
    attendees: ["Ann Ops", "Bo Security", "Cy Network"],
    decision: "approved",
    conditions: "Only after 20:00, with the network team on call",
    notes: "",
  });
  check("approved: the change moved to approved", res.status === 201 && res.json.status === "approved" && !res.json.cab.awaiting, `${res.status} ${message(res)}`);
  const decisions = res.json?.cab?.decisions ?? [];
  check(
    "history keeps both decisions, newest first, with attendees and who recorded them",
    decisions.length === 2 && decisions[0].decision === "approved" && decisions[1].decision === "deferred" &&
      decisions[0].attendees.length === 3 && decisions[0].recordedBy.includes("approver"),
    JSON.stringify(decisions).slice(0, 300),
  );
  res = await request("admin", "GET", `/api/objects/NormalChange/${id}?fields=status,approval_date,approval_comment`);
  check(
    "iTop has the approval date and a comment with the conditions",
    res.json?.fields?.approval_date && /^CAB \d{4}-\d{2}-\d{2}: approved\. Conditions: Only after 20:00/.test(res.json.fields.approval_comment ?? ""),
    JSON.stringify(res.json?.fields ?? {}),
  );
  res = await request("approver", "GET", "/api/changes/cab");
  check("no longer in the CAB queue", res.status === 200 && !res.json.items.some((i) => i.id === String(id)));
  res = await decide("approver", id, { meetingDate: meeting, attendees: [], decision: "approved", conditions: "", notes: "" });
  check("a second decision on an approved change is refused (409)", res.status === 409, `${res.status}`);

  res = await act("implementor", "NormalChange", id, "ev_implement");
  check("Implementor implements the approved change", res.status === 200 && res.json.fields?.status === "implemented", `${res.status} ${message(res)}`);
}

async function emergencyChange() {
  console.log("\nEmergency change: not approved");
  const id = await assignedChange("EmergencyChange", "hot-fix the VPN gateway");
  let res = await plans("implementor", id, { implementation: "Apply the hot-fix", rollback: "Re-flash the previous firmware", test: "Connect from outside" });
  check("all three plans saved", res.status === 200 && res.json.missing.plan.length === 0, res.text.slice(0, 200));
  res = await act("implementor", "EmergencyChange", id, "ev_plan", schedule());
  check("Plan applied (rollback plan already saved)", res.status === 200, `${res.status} ${message(res)}`);
  const meeting = new Date().toISOString().slice(0, 10);
  res = await decide("approver", id, { meetingDate: meeting, attendees: ["ECAB"], decision: "rejected", conditions: "", notes: "" });
  check("a rejection without notes is refused (400)", res.status === 400, `${res.status} ${message(res)}`);
  res = await decide("approver", id, { meetingDate: meeting, attendees: ["ECAB"], decision: "rejected", conditions: "", notes: "Wait for the vendor's fix" });
  check("rejected: the change is not approved", res.status === 201 && res.json.status === "not_approved", `${res.status} ${message(res)}`);
  res = await request("admin", "GET", `/api/objects/EmergencyChange/${id}?fields=status,reason`);
  check("iTop's reason carries the CAB's notes", /not approved\. Wait for the vendor's fix/.test(res.json?.fields?.reason ?? ""), JSON.stringify(res.json?.fields ?? {}));
}

async function routineChange() {
  console.log("\nRoutine change: implementation plan only");
  const id = await assignedChange("RoutineChange", "monthly patching");
  let res = await governance("implementor", id);
  check("no CAB for a routine change", res.status === 200 && res.json.cab.required === false && res.json.type === "routine");
  res = await act("implementor", "RoutineChange", id, "ev_plan", schedule());
  check("Plan refused naming the implementation plan only", res.status === 409 && /Add the implementation plan before planning this routine change/.test(message(res)), `${res.status} ${message(res)}`);
  await plans("implementor", id, { implementation: "Run the patch job" });
  res = await act("implementor", "RoutineChange", id, "ev_plan", schedule());
  check("Plan applied without a rollback plan (iTop no longer demands one)", res.status === 200 && res.json.fields?.status === "plannedscheduled", `${res.status} ${message(res)}`);

  const rules = (await request("admin", "GET", "/api/admin/change-rules")).json.rules;
  rules.routine.test = "implement";
  res = await request("admin", "PUT", "/api/admin/change-rules", { rules });
  check("administrator requires a test plan to implement routine changes", res.status === 200 && res.json.rules.routine.test === "implement" && res.json.updatedBy === config.changes.accounts.admin.login);
  res = await act("implementor", "RoutineChange", id, "ev_implement");
  check("Implement refused until the test plan is written", res.status === 409 && /Add the test plan before implementing/.test(message(res)), `${res.status} ${message(res)}`);
  await plans("implementor", id, { test: "Check the patch level report" });
  res = await act("implementor", "RoutineChange", id, "ev_implement");
  check("Implement applied once it is", res.status === 200 && res.json.fields?.status === "implemented", `${res.status} ${message(res)}`);
}

async function cleanup() {
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
