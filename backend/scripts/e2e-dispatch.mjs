/**
 * Team dispatch end to end, against a BFF and an iTop with the
 * arcus-ticket-dispatch extension:
 *
 *   - assignment rules (admin): saved, tried, and applied to new tickets
 *     from the incident form and the generic request form; a ticket no
 *     rule matches stays New;
 *   - the team's queue: each member sees what was dispatched to their
 *     teams, nobody else's;
 *   - Take it: only a team member, only once; the ticket is then Assigned
 *     to them and leaves the queue;
 *   - Dispatch to team by hand (Service Desk Agent) from the incident
 *     screen, and re-dispatch to another team from the records screen;
 *   - the team is emailed (Mailpit), at its own address or each member's.
 *
 * Tickets it raises are deleted at the end and the rules put back as they
 * were, pass or fail; the accounts, people, teams and the organisation are
 * made once and kept for the next run.
 *
 *   npm run e2e:dispatch                                BFF on http://127.0.0.1:4050
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:dispatch
 *
 * MFA stays on. Logins, passwords and TOTP secrets are in
 * backend/e2e.local.json (git-ignored) under "dispatch"; the first run makes
 * the accounts in iTop as the BFF's service account (ITOP_* in backend/.env).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const ENV = new URL("../.env", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4050");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5223";
const MAILPIT = process.env.E2E_MAILPIT ?? "http://localhost:8025";
const TAG = `e2e-dispatch ${new Date().toISOString().slice(0, 19)}`;

/** role -> [profiles, team ("a", "b" or none)] */
const ROLES = {
  admin: [["Administrator"], null],
  desk: [["Service Desk Agent"], null],
  a1: [["Support Agent"], "a"],
  a2: [["Support Agent"], "a"],
  b1: [["Support Agent"], "b"],
};
const TEAM_A_EMAIL = "e2e.dispatch.team-a@example.test";

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
let rulesBefore;

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

const strongPassword = () => `E2e-${crypto.randomBytes(9).toString("base64url")}!9a`;
const make = async (cls, fields) =>
  Number((await itop("core/create", { class: cls, fields, comment: "e2e-dispatch setup", output_fields: "id" }))[0].key);

async function bootstrap() {
  const profiles = await itop("core/get", { class: "URP_Profiles", key: "SELECT URP_Profiles", output_fields: "name" });
  const profileId = (name) => Number(profiles.find((p) => p.fields.name === name)?.key);

  const orgId = await make("Organization", { name: "E2E dispatch org" });
  const teams = {
    a: await make("Team", { name: "E2E dispatch team A", org_id: orgId, email: TEAM_A_EMAIL }),
    b: await make("Team", { name: "E2E dispatch team B", org_id: orgId }),
  };
  const out = { orgId, teams, accounts: {} };
  for (const [role, [names, team]] of Object.entries(ROLES)) {
    const login = `e2e.dispatch.${role}`;
    const personId = await make("Person", {
      name: role,
      first_name: "E2E dispatch",
      org_id: orgId,
      email: `${login}@example.test`,
    });
    if (team) await make("lnkPersonToTeam", { person_id: personId, team_id: teams[team] });
    const password = strongPassword();
    await make("UserLocal", {
      login,
      password,
      contactid: personId,
      language: "EN US",
      profile_list: [...names, "REST Services User"].map((n) => ({ profileid: profileId(n) })),
    });
    out.accounts[role] = { login, password, personId, totpSecret: "" };
  }
  config.dispatch = out;
  saveConfig();
  console.log(`  created org ${orgId}, teams ${teams.a} / ${teams.b}, accounts ${Object.values(out.accounts).map((a) => a.login).join(", ")}`);
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

/** Password, then the MFA step: enrols (saving the secret) or answers with a code. */
async function signIn(role) {
  const account = config.dispatch.accounts[role];
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
const reason = (res) => res.json?.error?.details?.reason;
const queueRefs = async (role) => ((await request(role, "GET", "/api/dispatch/queue")).json?.items ?? []).map((i) => i.ref);

/** Another organisation and one of its people: what no rule of ours matches. */
let elsewhere;

async function newIncident(role, title, organizationId, callerId = config.dispatch.accounts.desk.personId) {
  const res = await request(role, "POST", "/api/incidents", {
    title: `${TAG} ${title}`,
    description: "dispatch e2e",
    callerId: String(callerId),
    organizationId: String(organizationId),
  });
  if (res.status !== 201) throw new Error(`create incident: ${res.status} ${res.text.slice(0, 300)}`);
  created.push(["Incident", res.json.id]);
  return res.json;
}

/** Mailpit: the messages to `to` whose subject names `ref`, polled briefly (sending is after the answer). */
async function mailsTo(to, ref) {
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`);
    const found = ((await res.json()).messages ?? []).filter((m) => m.Subject?.includes(ref));
    if (found.length) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

/* ------------------------------------------------------------------------- *
 * The journeys
 * ------------------------------------------------------------------------- */

async function rules() {
  console.log("\nAssignment rules");
  const { orgId, teams } = config.dispatch;
  const before = await request("admin", "GET", "/api/admin/assignment-rules");
  check("the admin reads the rules; the extension is there", before.status === 200 && before.json.available === true, before.text.slice(0, 200));
  rulesBefore = { rules: before.json.rules, notifyTeam: before.json.notifyTeam };

  const refused = await request("desk", "GET", "/api/admin/assignment-rules");
  check("a Service Desk Agent may not read them (403)", refused.status === 403, `${refused.status}`);

  const ours = [
    { id: "e2e-dispatch-inc", name: "E2E incidents", enabled: true, ticketType: "incident", organizationId: String(orgId), teamId: String(teams.a) },
    { id: "e2e-dispatch-req", name: "E2E requests", enabled: true, ticketType: "request", organizationId: String(orgId), teamId: String(teams.b) },
  ];
  const saved = await request("admin", "PUT", "/api/admin/assignment-rules", {
    rules: [...ours, ...rulesBefore.rules.filter((r) => !r.id.startsWith("e2e-dispatch"))],
    notifyTeam: true,
  });
  check("our two rules are saved first, the others kept after them", saved.status === 200 && saved.json.rules[0]?.id === "e2e-dispatch-inc", message(saved));

  const bad = await request("admin", "PUT", "/api/admin/assignment-rules", { rules: [{ ...ours[0], teamId: "" }], notifyTeam: true });
  check("a rule without a team is a 400", bad.status === 400, `${bad.status}`);

  const tried = await request("admin", "POST", "/api/admin/assignment-rules/test", { ticketType: "request", organizationId: String(orgId) });
  check("trying a request of the org names the request rule", tried.json?.rule?.id === "e2e-dispatch-req", tried.text.slice(0, 200));
}

async function routing() {
  console.log("\nNew tickets are routed");
  const { orgId, teams, accounts } = config.dispatch;

  const incident = await newIncident("desk", "routed incident", orgId);
  check(
    "an incident of the org, from the staff form, comes back dispatched to team A",
    incident.status === "dispatched" && incident.team?.id === String(teams.a) && !incident.assignee,
    `${incident.status} ${JSON.stringify(incident.team)}`,
  );

  const reqRes = await request("desk", "POST", "/api/objects/UserRequest", {
    fields: { org_id: orgId, caller_id: accounts.desk.personId, title: `${TAG} routed request`, description: "<p>dispatch</p>", request_type: "service_request" },
    comment: TAG,
  });
  if (reqRes.status === 201) created.push(["UserRequest", reqRes.json.object.id]);
  check(
    "a request of the org, from the records form, comes back dispatched to team B",
    reqRes.status === 201 && reqRes.json.object.fields.status === "dispatched" && String(reqRes.json.object.fields.team_id) === String(teams.b),
    `${reqRes.status} ${reqRes.json?.object?.fields?.status} ${message(reqRes)}`,
  );

  const unmatched = await newIncident("desk", "unrouted incident", elsewhere.orgId, elsewhere.personId);
  check("an incident no rule matches stays New", unmatched.status === "new" && !unmatched.team, `${unmatched.status} ${JSON.stringify(unmatched.team)}`);

  const mails = await mailsTo(TEAM_A_EMAIL, incident.ref);
  check("team A is emailed at its own address, the ref in brackets", mails.length === 1 && mails[0].Subject.startsWith(`[${incident.ref}]`), JSON.stringify(mails.map((m) => m.Subject)));
  const ref = reqRes.json?.object?.fields?.ref ?? "?";
  const bMails = await mailsTo(`${accounts.b1.login}@example.test`, ref);
  check("team B has no address, so its member is emailed", bMails.length === 1, JSON.stringify(bMails.map((m) => m.Subject)));

  return { incident, request: { id: String(reqRes.json?.object?.id), ref }, unmatched };
}

async function queueAndTake({ incident, request: req }) {
  console.log("\nThe team's queue and Take it");
  const a1Queue = await queueRefs("a1");
  check("team A's member sees the incident, not team B's request", a1Queue.includes(incident.ref) && !a1Queue.includes(req.ref), JSON.stringify(a1Queue));
  const b1Queue = await queueRefs("b1");
  check("team B's member sees the request, not team A's incident", b1Queue.includes(req.ref) && !b1Queue.includes(incident.ref), JSON.stringify(b1Queue));

  const detail = await request("a1", "GET", `/api/incidents/${incident.id}`);
  check("the incident screen offers Assign and Dispatch while it waits", detail.status === 200 && ["assign", "dispatch"].every((a) => detail.json.availableActions.includes(a)), JSON.stringify(detail.json?.availableActions));

  const outsider = await request("b1", "POST", `/api/dispatch/incident/${incident.id}/take`, {});
  check("someone outside team A may not take it (403 not_in_team)", outsider.status === 403 && reason(outsider) === "not_in_team", `${outsider.status} ${message(outsider)}`);

  const taken = await request("a1", "POST", `/api/dispatch/incident/${incident.id}/take`, {});
  check("team A's member takes it", taken.status === 200 && taken.json.ref === incident.ref, `${taken.status} ${message(taken)}`);
  const after = await request("a1", "GET", `/api/incidents/${incident.id}`);
  check(
    "it is now assigned to them, in team A",
    after.json?.status === "open" && after.json.assignee?.id === String(config.dispatch.accounts.a1.personId) && after.json.team?.id === String(config.dispatch.teams.a),
    `${after.json?.status} ${JSON.stringify(after.json?.assignee)}`,
  );
  check("and it has left the queue", !(await queueRefs("a2")).includes(incident.ref));

  const again = await request("a2", "POST", `/api/dispatch/incident/${incident.id}/take`, {});
  check("a colleague taking it after that gets a 409 naming who has it", again.status === 409 && /already been taken by/.test(message(again)), `${again.status} ${message(again)}`);

  const reqTaken = await request("b1", "POST", `/api/dispatch/request/${req.id}/take`, {});
  check("team B's member takes the request", reqTaken.status === 200, `${reqTaken.status} ${message(reqTaken)}`);
  const status = (await request("admin", "GET", `/api/objects/UserRequest/${req.id}?fields=status,agent_id`)).json?.fields;
  check("the request is assigned to them", status?.status === "assigned" && String(status.agent_id) === String(config.dispatch.accounts.b1.personId), JSON.stringify(status));
}

async function byHand({ unmatched }) {
  console.log("\nDispatch by hand");
  const { teams } = config.dispatch;
  const offered = await request("desk", "GET", `/api/incidents/${unmatched.id}`);
  check("a Service Desk Agent is offered Assign and Dispatch on a new incident", JSON.stringify(offered.json?.availableActions) === JSON.stringify(["assign", "dispatch"]), JSON.stringify(offered.json?.availableActions));

  const noTeam = await request("desk", "POST", `/api/incidents/${unmatched.id}/transitions`, { action: "dispatch" });
  check("dispatching without a team is a 400", noTeam.status === 400, `${noTeam.status} ${message(noTeam)}`);

  const sent = await request("desk", "POST", `/api/incidents/${unmatched.id}/transitions`, { action: "dispatch", teamId: String(teams.a) });
  check("the Service Desk Agent dispatches it to team A", sent.status === 200 && sent.json.status === "dispatched" && sent.json.team?.id === String(teams.a), `${sent.status} ${message(sent)}`);
  check("team A is emailed about it too", (await mailsTo(TEAM_A_EMAIL, unmatched.ref)).length === 1);

  const moved = await request("desk", "POST", `/api/objects/Incident/${unmatched.id}/stimulus`, { stimulus: "ev_dispatch", fields: { team_id: teams.b }, comment: TAG });
  check("re-dispatched to team B from the records screen", moved.status === 200 && moved.json.fields?.status === "dispatched" && String(moved.json.fields?.team_id) === String(teams.b), `${moved.status} ${message(moved)}`);
  check("so it is in team B's queue, not team A's", (await queueRefs("b1")).includes(unmatched.ref) && !(await queueRefs("a1")).includes(unmatched.ref));

  const assigned = await request("desk", "POST", `/api/incidents/${unmatched.id}/transitions`, { action: "assign", agentId: String(config.dispatch.accounts.b1.personId) });
  check("Assign still works from Dispatched (an agent of the team)", assigned.status === 200 && assigned.json.status === "open", `${assigned.status} ${message(assigned)}`);
}

async function main() {
  console.log("Accounts");
  if (!config.dispatch) await bootstrap();
  const people = await itop("core/get", {
    class: "Person",
    key: `SELECT Person AS p JOIN Organization AS o ON p.org_id = o.id WHERE o.id != ${config.dispatch.orgId} AND o.status = 'active' AND p.status = 'active'`,
    output_fields: "org_id",
    limit: 1,
  });
  if (!people[0]) throw new Error("this iTop has nobody outside the E2E dispatch org to raise an unmatched incident for");
  elsewhere = { orgId: Number(people[0].fields.org_id), personId: Number(people[0].key) };
  for (const role of Object.keys(ROLES)) {
    const user = await signIn(role);
    check(`${role} signed in (${config.dispatch.accounts[role].login})`, Boolean(user));
  }
  await rules();
  const tickets = await routing();
  await queueAndTake(tickets);
  await byHand(tickets);
}

async function cleanup() {
  if (rulesBefore) {
    const res = await request("admin", "PUT", "/api/admin/assignment-rules", rulesBefore);
    if (res.status !== 200) console.log(`  (could not put the rules back: ${res.status} ${res.text.slice(0, 120)})`);
  }
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
