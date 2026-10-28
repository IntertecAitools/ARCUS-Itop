/**
 * Lifecycle rights end to end: the BFF applies iTop's per-action (stimulus)
 * grants, which iTop's REST API does not check, on incidents, user requests
 * and problems. Each step runs as an iTop profile from itop-profiles-itil:
 *
 *   - Service Desk Agent: may assign incidents and requests, nothing else
 *     (no resolve, reassign or hold; no problem actions);
 *   - Configuration ReadOnly: may apply no action at all;
 *   - Support Agent: reassigns an incident, may not assign a problem;
 *   - Problem Manager: assigns a problem.
 * Refusals are 403 with reason "profile_not_allowed" and leave iTop's record
 * unchanged; the actions offered (`availableActions` on the incident screen,
 * `lifecycle.allowedActions` on the records screens) match the grants.
 * The tickets it creates are deleted at the end, pass or fail; the accounts,
 * people and team are created once and kept for the next run.
 *
 *   npm run e2e:rights                               BFF on http://127.0.0.1:4030
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:rights
 *
 * MFA stays on. The accounts' logins, passwords and TOTP secrets live in
 * backend/e2e.local.json (git-ignored), under "rights"; the first run creates
 * them in iTop as the BFF's service account (ITOP_* in backend/.env) and
 * enrols each in MFA.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const ENV = new URL("../.env", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4030");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5203";
const TAG = `e2e-rights ${new Date().toISOString().slice(0, 19)}`;

const ROLES = {
  admin: ["Administrator"],
  desk: ["Service Desk Agent"],
  readonly: ["Configuration ReadOnly"],
  support: ["Support Agent"],
  problem: ["Problem Manager"],
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
    fields: { name: "E2E rights team", org_id: orgId },
    comment: "e2e-rights setup",
    output_fields: "id",
  });
  const out = { orgId, teamId: Number(team[0].key), accounts: {} };
  for (const [role, names] of Object.entries(ROLES)) {
    const login = `e2e.rights.${role}`;
    const person = await itop("core/create", {
      class: "Person",
      fields: { name: role, first_name: "E2E rights", org_id: orgId, email: `${login}@example.test` },
      comment: "e2e-rights setup",
      output_fields: "id",
    });
    const personId = Number(person[0].key);
    await itop("core/create", {
      class: "lnkPersonToTeam",
      fields: { person_id: personId, team_id: out.teamId },
      comment: "e2e-rights setup",
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
      comment: "e2e-rights setup",
      output_fields: "id",
    });
    out.accounts[role] = { login, password, personId, totpSecret: "" };
  }
  config.rights = out;
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
  const account = config.rights.accounts[role];
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

async function create(className, fields) {
  const res = await request("admin", "POST", `/api/objects/${className}`, { fields, comment: TAG });
  if (res.status !== 201) throw new Error(`create ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  created.push([className, res.json.object.id]);
  return res.json.object.id;
}

const act = (role, cls, id, stimulus, fields = {}) =>
  request(role, "POST", `/api/objects/${cls}/${id}/stimulus`, { stimulus, fields, comment: TAG });
const reason = (res) => res.json?.error?.details?.reason;
const message = (res) => res.json?.error?.message ?? res.text.slice(0, 200);
const statusOf = async (cls, id) => (await request("admin", "GET", `/api/objects/${cls}/${id}?fields=status`)).json?.fields?.status;
const allowed = async (role, cls) => (await request(role, "GET", `/api/meta/classes/${cls}`)).json?.lifecycle?.allowedActions;
const same = (a, b) => JSON.stringify([...(a ?? ["(none sent)"])].sort()) === JSON.stringify([...b].sort());

/** A refusal for want of a profile: 403, our reason, the profile it needs, iTop untouched. */
async function refused(name, res, needs, cls, id, before) {
  const after = await statusOf(cls, id);
  check(
    name,
    res.status === 403 && reason(res) === "profile_not_allowed" && needs.test(message(res)) && after === before,
    `${res.status} ${reason(res)} ${message(res)} (status ${before} -> ${after})`,
  );
}

async function offered() {
  console.log("\nActions offered match the grants");
  check("Service Desk Agent: Incident offers Assign only", same(await allowed("desk", "Incident"), ["ev_assign"]), JSON.stringify(await allowed("desk", "Incident")));
  check("Service Desk Agent: UserRequest offers Assign only", same(await allowed("desk", "UserRequest"), ["ev_assign"]));
  check("Service Desk Agent: Problem offers nothing", same(await allowed("desk", "Problem"), []));
  for (const cls of ["Incident", "UserRequest", "Problem"]) {
    check(`Configuration ReadOnly: ${cls} offers nothing`, same(await allowed("readonly", cls), []), JSON.stringify(await allowed("readonly", cls)));
  }
  check(
    "Support Agent: Incident offers assign, reassign, hold, resolve, close (not reopen)",
    same(await allowed("support", "Incident"), ["ev_assign", "ev_reassign", "ev_pending", "ev_resolve", "ev_close"]),
    JSON.stringify(await allowed("support", "Incident")),
  );
  check("Problem Manager: Problem offers its four actions", same(await allowed("problem", "Problem"), ["ev_assign", "ev_reassign", "ev_resolve", "ev_close"]));
  const all = await allowed("admin", "Incident");
  check("Administrator: Incident offers every user action", Boolean(all?.includes("ev_reopen") && all?.includes("ev_resolve")), JSON.stringify(all));
}

async function incident() {
  console.log("\nIncident");
  const { orgId, teamId, accounts } = config.rights;
  const assignTo = { team_id: teamId, agent_id: accounts.desk.personId };
  const id = await create("Incident", { org_id: orgId, caller_id: accounts.desk.personId, title: `${TAG} incident`, description: "<p>rights</p>" });
  let res = await request("desk", "GET", `/api/incidents/${id}`);
  check("incident screen offers the Service Desk Agent Assign on a new incident", res.status === 200 && same(res.json.availableActions, ["assign"]), `${res.status} ${JSON.stringify(res.json?.availableActions)}`);
  await refused("Configuration ReadOnly may not assign (403)", await act("readonly", "Incident", id, "ev_assign", assignTo), /needs Service Desk Agent or Support Agent/, "Incident", id, "new");
  res = await act("desk", "Incident", id, "ev_assign", assignTo);
  check("Service Desk Agent assigns the incident", res.status === 200 && res.json.fields?.status === "assigned", `${res.status} ${message(res)}`);
  res = await request("desk", "GET", `/api/incidents/${id}`);
  check("then the incident screen offers the Service Desk Agent nothing", res.status === 200 && same(res.json.availableActions, []), JSON.stringify(res.json?.availableActions));
  res = await request("support", "GET", `/api/incidents/${id}`);
  check("... and the Support Agent hold, reassign and resolve", res.status === 200 && same(res.json.availableActions, ["hold", "reassign", "resolve"]), JSON.stringify(res.json?.availableActions));
  await refused("Service Desk Agent may not resolve (403, generic action)", await act("desk", "Incident", id, "ev_resolve", { solution: "x" }), /incident \(it needs Support Agent\)/, "Incident", id, "assigned");
  await refused(
    "Service Desk Agent may not resolve (403, incident screen)",
    await request("desk", "POST", `/api/incidents/${id}/transitions`, { action: "resolve", solution: "x" }),
    /needs Support Agent/,
    "Incident",
    id,
    "assigned",
  );
  await refused("Service Desk Agent may not reassign (403)", await act("desk", "Incident", id, "ev_reassign", assignTo), /needs Support Agent/, "Incident", id, "assigned");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await refused(
    "Service Desk Agent may not put it on hold (403)",
    await act("desk", "Incident", id, "ev_pending", { pending_reason: "waiting", next_action_date: tomorrow }),
    /needs Support Agent/,
    "Incident",
    id,
    "assigned",
  );
  res = await request("desk", "POST", "/api/objects/Incident/bulk", { action: "stimulus", ids: [id], stimulus: "ev_reassign", fields: assignTo, comment: TAG });
  check(
    "a bulk action refuses it per record",
    res.status === 200 && /profiles do not allow/.test(JSON.stringify(res.json)) && (await statusOf("Incident", id)) === "assigned",
    res.text.slice(0, 300),
  );
  res = await act("support", "Incident", id, "ev_reassign", { team_id: teamId, agent_id: accounts.support.personId });
  check("Support Agent reassigns it", res.status === 200 && res.json.fields?.status === "assigned", `${res.status} ${message(res)}`);
}

async function userRequest() {
  console.log("\nUser request");
  const { orgId, teamId, accounts } = config.rights;
  const assignTo = { team_id: teamId, agent_id: accounts.desk.personId };
  const id = await create("UserRequest", {
    org_id: orgId,
    caller_id: accounts.desk.personId,
    title: `${TAG} request`,
    description: "<p>rights</p>",
    request_type: "service_request",
  });
  await refused("Configuration ReadOnly may not assign (403)", await act("readonly", "UserRequest", id, "ev_assign", assignTo), /user request \(it needs Service Desk Agent or Support Agent\)/, "UserRequest", id, "new");
  const res = await act("desk", "UserRequest", id, "ev_assign", assignTo);
  check("Service Desk Agent assigns the request", res.status === 200 && res.json.fields?.status === "assigned", `${res.status} ${message(res)}`);
  await refused("Service Desk Agent may not resolve (403)", await act("desk", "UserRequest", id, "ev_resolve", { solution: "x" }), /needs Support Agent/, "UserRequest", id, "assigned");
}

async function problem() {
  console.log("\nProblem");
  const { orgId, teamId, accounts } = config.rights;
  const assignTo = { team_id: teamId, agent_id: accounts.desk.personId };
  const id = await create("Problem", { org_id: orgId, title: `${TAG} problem`, description: "<p>rights</p>" });
  await refused("Service Desk Agent may not assign a problem (403)", await act("desk", "Problem", id, "ev_assign", assignTo), /problem \(it needs Problem Manager\)/, "Problem", id, "new");
  await refused("Support Agent may not assign a problem (403)", await act("support", "Problem", id, "ev_assign", assignTo), /needs Problem Manager/, "Problem", id, "new");
  await refused("Configuration ReadOnly may not assign a problem (403)", await act("readonly", "Problem", id, "ev_assign", assignTo), /needs Problem Manager/, "Problem", id, "new");
  const res = await act("problem", "Problem", id, "ev_assign", { team_id: teamId, agent_id: accounts.problem.personId });
  check("Problem Manager assigns it", res.status === 200 && res.json.fields?.status === "assigned", `${res.status} ${message(res)}`);
}

async function main() {
  console.log("Accounts");
  if (!config.rights) await bootstrap();
  for (const role of Object.keys(ROLES)) {
    const user = await signIn(role);
    check(`${role} signed in with password and TOTP (${config.rights.accounts[role].login})`, Boolean(user));
  }
  await offered();
  await incident();
  await userRequest();
  await problem();
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
