/**
 * Change calendar, risk questionnaire, post-implementation reviews and the
 * knowledge article workflow, end to end against a running BFF and local
 * iTop (with arcus-change-cab). Reuses the change accounts of
 * `npm run e2e:changes` (backend/e2e.local.json, "changes"), plus a portal
 * user made once under "knowledge":
 *
 *   - blackout windows are administrators' to set; a normal and a routine
 *     change planned on the same CI at the same time show on the calendar,
 *     clashing with each other and inside the window; the team, CI and
 *     organisation filters narrow it;
 *   - a routine change scoring high risk is refused at Plan (it must go the
 *     CAB route); scoring low, it plans. With the questionnaire required for
 *     normal changes, Plan is refused until it is answered;
 *   - a review cannot be written before the change is implemented; once the
 *     routine change is implemented it is in the PIR due queue, the review
 *     links an incident by its ref, and the queue no longer lists it;
 *   - a FAQ made through the BFF starts as a draft the portal does not show;
 *     a reviewer (the configured profile) sends it back with a comment, then
 *     approves it; the portal shows it and takes "was this helpful?" votes
 *     (one per reader), staff vote too, the author sees the comments;
 *     retired, it leaves the portal.
 * Everything it creates (changes, incident, FAQ, blackout window, and the
 * BFF's own rows for them) is deleted at the end, pass or fail; the risk
 * questions and knowledge settings are put back.
 *
 *   npm run e2e:change-knowledge                         BFF on http://127.0.0.1:4090
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:change-knowledge
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import { createConnection } from "mysql2/promise";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const ENV = new URL("../.env", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4090");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5263";
const TAG = `e2e-chg-kb ${new Date().toISOString().slice(0, 19)}`;

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
/** BFF document rows to remove at the end: [kind, key or key prefix + "%"]. */
const documents = [];
const blackouts = [];

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
 * Bootstrap: a portal user, a FAQ category and a CI, made once as the service account
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
  const { orgId } = config.changes;
  const profiles = await itop("core/get", { class: "URP_Profiles", key: "SELECT URP_Profiles", output_fields: "name" });
  const portalProfile = Number(profiles.find((p) => p.fields.name === "Portal user")?.key);
  const login = "e2e.kb.reader";
  const person = await itop("core/create", {
    class: "Person",
    fields: { name: "reader", first_name: "E2E knowledge", org_id: orgId, email: `${login}@example.test` },
    comment: "e2e-change-knowledge setup",
    output_fields: "id",
  });
  const personId = Number(person[0].key);
  const password = strongPassword();
  await itop("core/create", {
    class: "UserLocal",
    fields: { login, password, contactid: personId, language: "EN US", profile_list: [{ profileid: portalProfile }] },
    comment: "e2e-change-knowledge setup",
    output_fields: "id",
  });
  const category = await itop("core/create", {
    class: "FAQCategory",
    fields: { name: "E2E knowledge" },
    comment: "e2e-change-knowledge setup",
    output_fields: "id",
  });
  const ci = await itop("core/create", {
    class: "ApplicationSolution",
    fields: { name: "E2E change calendar app", org_id: orgId },
    comment: "e2e-change-knowledge setup",
    output_fields: "id",
  });
  config.knowledge = {
    reader: { login, password, personId, totpSecret: "" },
    categoryId: Number(category[0].key),
    ciId: Number(ci[0].key),
  };
  saveConfig();
  console.log(`  created portal user ${login}, FAQ category ${config.knowledge.categoryId}, CI ${config.knowledge.ciId}`);
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

const accountOf = (role) => (role === "reader" ? config.knowledge.reader : config.changes.accounts[role]);

/** Password, then the MFA step when the policy asks for one: enrols (saving the secret) or answers with a code. */
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

async function create(role, className, fields) {
  const res = await request(role, "POST", `/api/objects/${className}`, { fields, comment: TAG });
  if (res.status !== 201) throw new Error(`create ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  created.push([className, res.json.object.id]);
  return res.json.object.id;
}

const act = (role, cls, id, stimulus, fields = {}) =>
  request(role, "POST", `/api/objects/${cls}/${id}/stimulus`, { stimulus, fields, comment: TAG });
const reason = (res) => res.json?.error?.details?.reason;
const message = (res) => res.json?.error?.message ?? res.text.slice(0, 200);
const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

/** Raises a change, takes it to Assigned as the supervisor, and puts the e2e CI on it. */
async function assignedChange(cls, title) {
  const { orgId, teamId, accounts } = config.changes;
  const id = await create("supervisor", cls, {
    org_id: orgId,
    title: `${TAG} ${title}`,
    description: `<p>${title}</p>`,
    caller_id: accounts.supervisor.personId,
  });
  documents.push(["change-risk", String(id)], ["change-pir", String(id)]);
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
  const link = await request("admin", "POST", `/api/objects/${cls}/${id}/links/functionalcis_list`, {
    targetId: config.knowledge.ciId,
  });
  if (link.status !== 201) throw new Error(`link CI: ${link.status} ${message(link)}`);
  return id;
}

/** Both changes run from +48h to +50h. */
const schedule = { start_date: inHours(48), end_date: inHours(50), impact: "App restarts", outage: "no" };

/* ------------------------------------------------------------------------- *
 * The run
 * ------------------------------------------------------------------------- */

const state = {};

async function main() {
  console.log("Accounts");
  if (!config.changes) throw new Error("run `npm run e2e:changes` once first: its accounts are reused");
  if (!config.knowledge) await bootstrap();
  for (const role of ["admin", "supervisor", "implementor", "approver", "reader"]) {
    const user = await signIn(role);
    check(`${role} signed in (${accountOf(role).login})`, Boolean(user));
  }

  let res = await request("admin", "GET", "/api/admin/change-risk");
  state.riskModel = res.json?.model;
  res = await request("admin", "GET", "/api/admin/knowledge-settings");
  state.knowledgeSettings = res.json;
  res = await request("admin", "GET", "/api/admin/change-rules");
  state.planRules = res.json?.rules;
  await request("admin", "PUT", "/api/admin/change-rules", { rules: res.json.defaults });

  await risk();
  await calendar();
  await pir();
  await knowledge();
}

async function risk() {
  console.log("\nRisk questionnaire");
  let res = await request("implementor", "PUT", "/api/admin/change-risk", { model: state.riskModel });
  check("risk questions are administrators' only (403 for an implementor)", res.status === 403, `${res.status}`);

  const model = structuredClone(state.riskModel);
  model.requiredBeforePlan.normal = true;
  res = await request("admin", "PUT", "/api/admin/change-risk", { model });
  check("administrator requires the questionnaire before a normal change is planned", res.status === 200 && res.json.model.requiredBeforePlan.normal === true, message(res));

  // Routine: high risk keeps it off the pre-approved path.
  state.routine = await assignedChange("RoutineChange", "restart the app");
  const r = state.routine;
  await request("implementor", "PUT", `/api/changes/${r}/plans`, { implementation: "Restart the service" });
  res = await request("implementor", "GET", `/api/changes/${r}/risk`);
  check("a routine change's questions, not yet answered", res.status === 200 && res.json.questions.length > 0 && res.json.score === null, res.text.slice(0, 200));
  const questions = res.json.questions;
  const pick = (which) => Object.fromEntries(questions.map((q) => [q.id, (which === "high" ? q.options.at(-1) : q.options[0]).id]));

  res = await request("implementor", "PUT", `/api/changes/${r}/risk`, { answers: { [questions[0].id]: questions[0].options[0].id } });
  check("partial answers are refused (400)", res.status === 400 && /Answer every question/.test(message(res)), `${res.status} ${message(res)}`);
  res = await request("implementor", "PUT", `/api/changes/${r}/risk`, { answers: pick("high") });
  check("highest answers score 100, high, forcing the CAB route", res.status === 200 && res.json.score === 100 && res.json.level === "high" && res.json.forcesCab === true, res.text.slice(0, 200));
  check("the assessment records who made it", res.json?.assessedBy === config.changes.accounts.implementor.login, res.json?.assessedBy);
  res = await act("implementor", "RoutineChange", r, "ev_plan", schedule);
  check("Plan refused for a high-risk routine change (409 risk_needs_cab)", res.status === 409 && reason(res) === "risk_needs_cab", `${res.status} ${message(res)}`);
  res = await request("implementor", "PUT", `/api/changes/${r}/risk`, { answers: pick("low") });
  check("lowest answers score 0, low", res.status === 200 && res.json.score === 0 && res.json.level === "low", res.text.slice(0, 200));
  res = await act("implementor", "RoutineChange", r, "ev_plan", schedule);
  check("Plan applied once the risk is low", res.status === 200 && res.json.fields?.status === "plannedscheduled", `${res.status} ${message(res)}`);

  // Normal: the questionnaire is required before planning.
  state.normal = await assignedChange("NormalChange", "upgrade the app");
  const n = state.normal;
  await request("implementor", "PUT", `/api/changes/${n}/plans`, {
    implementation: "Upgrade in place",
    rollback: "Restore the snapshot",
    test: "Smoke test the login page",
  });
  res = await act("implementor", "NormalChange", n, "ev_plan", schedule);
  check("Plan refused until the questionnaire is answered (409 risk_missing)", res.status === 409 && reason(res) === "risk_missing", `${res.status} ${message(res)}`);
  res = await request("implementor", "GET", `/api/changes/${n}/risk`);
  const nq = res.json.questions;
  res = await request("implementor", "PUT", `/api/changes/${n}/risk`, {
    answers: Object.fromEntries(nq.map((q) => [q.id, q.options[Math.min(1, q.options.length - 1)].id])),
  });
  check("normal change assessed (medium answers)", res.status === 200 && typeof res.json.score === "number" && res.json.required === true, res.text.slice(0, 200));
  res = await act("implementor", "NormalChange", n, "ev_plan", schedule);
  check("Plan applied once answered", res.status === 200 && res.json.fields?.status === "plannedscheduled", `${res.status} ${message(res)}`);
}

async function calendar() {
  console.log("\nCalendar and blackout windows");
  const window = { name: `${TAG} freeze`, start: inHours(47), end: inHours(51), reason: "e2e" };
  let res = await request("implementor", "POST", "/api/admin/change-blackouts", window);
  check("blackout windows are administrators' only (403 for an implementor)", res.status === 403, `${res.status}`);
  res = await request("admin", "POST", "/api/admin/change-blackouts", window);
  check("administrator adds a blackout window", res.status === 201 && res.json.id, res.text.slice(0, 200));
  if (res.json?.id) blackouts.push(res.json.id);
  res = await request("admin", "POST", "/api/admin/change-blackouts", { ...window, end: window.start });
  check("a window that ends before it starts is refused (400)", res.status === 400, `${res.status}`);

  const query = new URLSearchParams({ from: inHours(0), to: inHours(24 * 5) });
  res = await request("implementor", "GET", `/api/changes/calendar?${query}`);
  check("staff read the calendar", res.status === 200 && Array.isArray(res.json.items), res.text.slice(0, 200));
  const find = (id) => res.json.items.find((i) => i.id === String(id));
  const normal = find(state.normal);
  const routine = find(state.routine);
  check("both planned changes are on it, typed", normal?.type === "normal" && routine?.type === "routine", JSON.stringify(res.json.items.map((i) => i.ref)));
  check("they clash on the shared CI, both ways", normal?.clashes.some((c) => c.changeId === String(state.routine) && c.on.some((o) => o.kind === "ci")) && routine?.clashes.some((c) => c.changeId === String(state.normal)), JSON.stringify(normal?.clashes));
  check("both are flagged inside the blackout window", normal?.blackouts.some((b) => b.name === window.name) && routine?.blackouts.length > 0, JSON.stringify(normal?.blackouts));
  check("the window is listed with the calendar", res.json.blackouts.some((b) => b.name === window.name));
  check("the normal change carries its risk level", ["low", "medium", "high"].includes(normal?.risk), normal?.risk);
  check("the CI is offered as a filter", res.json.options.cis.some((c) => c.id === String(config.knowledge.ciId)));

  const filtered = async (key, value) => {
    const q = new URLSearchParams({ from: inHours(0), to: inHours(24 * 5), [key]: String(value) });
    const r = await request("implementor", "GET", `/api/changes/calendar?${q}`);
    return r.json?.items.map((i) => i.id) ?? [];
  };
  const both = [String(state.normal), String(state.routine)];
  const byCi = await filtered("ciId", config.knowledge.ciId);
  check("filter by CI: exactly the changes on it", both.every((id) => byCi.includes(id)), JSON.stringify(byCi));
  const byTeam = await filtered("teamId", config.changes.teamId);
  check("filter by team", both.every((id) => byTeam.includes(id)), JSON.stringify(byTeam));
  const byOtherOrg = await filtered("orgId", 999999);
  check("filter by another organisation hides them", !both.some((id) => byOtherOrg.includes(id)), JSON.stringify(byOtherOrg));
  res = await request("implementor", "GET", `/api/changes/calendar?${new URLSearchParams({ from: inHours(0), to: inHours(24 * 200) })}`);
  check("a window over 100 days is refused (400)", res.status === 400, `${res.status}`);
}

async function pir() {
  console.log("\nPost-implementation review");
  const n = state.normal;
  const r = state.routine;
  let res = await request("implementor", "GET", `/api/changes/${n}/pir`);
  check("not yet due on a planned change", res.status === 200 && res.json.allowed === false && res.json.due === false, res.text.slice(0, 200));
  res = await request("implementor", "PUT", `/api/changes/${n}/pir`, { outcome: "successful" });
  check("a review before implementation is refused (409)", res.status === 409 && reason(res) === "not_implemented", `${res.status} ${message(res)}`);

  res = await act("implementor", "RoutineChange", r, "ev_implement");
  check("the routine change is implemented", res.status === 200 && res.json.fields?.status === "implemented", `${res.status} ${message(res)}`);
  res = await request("implementor", "GET", "/api/changes/pir-due");
  check("it is in the PIR due queue", res.status === 200 && res.json.items.some((i) => i.id === String(r)), res.text.slice(0, 200));

  const { orgId, accounts } = config.changes;
  const incidentId = await create("admin", "Incident", {
    org_id: orgId,
    caller_id: accounts.supervisor.personId,
    title: `${TAG} app slow after restart`,
    description: "<p>Slow</p>",
  });
  const incident = await request("admin", "GET", `/api/objects/Incident/${incidentId}`);
  const incidentRef = incident.json?.fields?.ref ?? incident.json?.object?.fields?.ref;

  res = await request("implementor", "PUT", `/api/changes/${r}/pir`, { outcome: "partial", wentWell: "Quick", wentBadly: "", incidents: [] });
  check("a partial outcome needs what went badly (400)", res.status === 400, `${res.status} ${message(res)}`);
  res = await request("implementor", "PUT", `/api/changes/${r}/pir`, {
    outcome: "partial",
    wentWell: "Done inside the window",
    wentBadly: "The app was slow for ten minutes",
    incidents: ["I-999999"],
  });
  check("an unknown incident is refused (400)", res.status === 400 && /I-999999/.test(message(res)), `${res.status} ${message(res)}`);
  res = await request("implementor", "PUT", `/api/changes/${r}/pir`, {
    outcome: "partial",
    wentWell: "Done inside the window",
    wentBadly: "The app was slow for ten minutes",
    incidents: [incidentRef ?? String(incidentId)],
    followUps: [{ text: "Warm the cache before reopening", owner: "Ops", due: "2026-12-01", done: false }],
  });
  check("the review is saved, linking the incident by ref", res.status === 200 && res.json.review?.incidents[0]?.id === String(incidentId) && res.json.due === false, res.text.slice(0, 300));
  check("with its follow-up action and author", res.json?.review?.followUps.length === 1 && res.json.review.completedBy === accounts.implementor.login);
  res = await request("implementor", "GET", "/api/changes/pir-due");
  check("the queue no longer lists it", res.status === 200 && !res.json.items.some((i) => i.id === String(r)));
}

async function knowledge() {
  console.log("\nKnowledge workflow and feedback");
  let res = await request("implementor", "GET", "/api/admin/knowledge-settings");
  check("knowledge settings are administrators' only (403)", res.status === 403, `${res.status}`);
  res = await request("admin", "PUT", "/api/admin/knowledge-settings", { reviewerProfiles: ["Change Approver"], reviewIntervalDays: 90 });
  check("administrator makes Change Approvers the reviewers", res.status === 200 && res.json.reviewerProfiles[0] === "Change Approver", message(res));

  const title = `${TAG} reset the app cache`;
  const id = await create("admin", "FAQ", {
    title,
    summary: "Clear the cache from the settings page.",
    description: "<p>Open Settings, then Clear cache.</p>",
    category_id: config.knowledge.categoryId,
  });
  documents.push(["kb-article", `faq:${id}`], ["kb-feedback", `faq:${id}/%`]);
  const path = `/api/knowledge/articles/faq/${id}`;
  res = await request("admin", "GET", path);
  check("a new FAQ is its author's draft", res.status === 200 && res.json.state === "draft" && res.json.author === config.changes.accounts.admin.login && res.json.actions.join() === "submit", res.text.slice(0, 300));
  const portalHas = async () => {
    const list = await request("reader", "GET", `/api/portal/faqs?q=${encodeURIComponent(TAG)}`);
    return list.json?.items?.some((f) => f.id === id);
  };
  check("the portal does not list a draft", (await portalHas()) === false);
  res = await request("reader", "GET", `/api/portal/faqs/${id}`);
  check("nor open it (404)", res.status === 404, `${res.status}`);
  res = await request("reader", "GET", "/api/knowledge/articles");
  check("end users cannot reach the staff knowledge API", res.status === 403 || res.status === 401, `${res.status}`);

  res = await request("admin", "POST", `${path}/actions`, { action: "submit", comment: "" });
  check("the author submits it for review", res.status === 200 && res.json.state === "in_review", message(res));
  res = await request("implementor", "POST", `${path}/actions`, { action: "approve", comment: "" });
  check("a non-reviewer may not approve (403)", res.status === 403, `${res.status} ${message(res)}`);
  res = await request("approver", "POST", `${path}/actions`, { action: "send_back", comment: "" });
  check("sending back needs a comment (400)", res.status === 400, `${res.status}`);
  res = await request("approver", "POST", `${path}/actions`, { action: "send_back", comment: "Say where Settings is" });
  check("the reviewer sends it back with a comment", res.status === 200 && res.json.state === "draft" && res.json.history[0]?.comment === "Say where Settings is", message(res));
  await request("admin", "POST", `${path}/actions`, { action: "submit", comment: "Added the menu path" });
  res = await request("approver", "POST", `${path}/actions`, { action: "approve", comment: "" });
  const due = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  check("the reviewer approves: published, next review in 90 days", res.status === 200 && res.json.state === "published" && Math.abs(Date.parse(res.json.reviewDue) - Date.parse(due)) <= 86_400_000, `${res.json?.state} ${res.json?.reviewDue}`);

  check("the portal lists it now", (await portalHas()) === true);
  res = await request("reader", "GET", `/api/portal/faqs/${id}`);
  check("and opens it", res.status === 200 && res.json.title === title, `${res.status}`);
  res = await request("reader", "POST", `/api/portal/faqs/${id}/feedback`, { helpful: false, comment: "Where is Settings?" });
  check("a reader votes not helpful, with a comment", res.status === 200 && res.json.no === 1 && res.json.score === 0, res.text.slice(0, 200));
  res = await request("reader", "POST", `/api/portal/faqs/${id}/feedback`, { helpful: true, comment: "Found it" });
  check("voting again replaces the vote", res.status === 200 && res.json.yes === 1 && res.json.no === 0, res.text.slice(0, 200));
  res = await request("implementor", "POST", `${path}/feedback`, { helpful: true, comment: "" });
  check("staff vote from staff search", res.status === 200 && res.json.yes === 2 && res.json.score === 100, res.text.slice(0, 200));
  res = await request("admin", "GET", path);
  check("the author sees each vote and comment, from where", res.json?.feedback.length === 2 && res.json.feedback.some((f) => f.source === "portal" && f.comment === "Found it") && res.json.feedback.some((f) => f.source === "staff"), JSON.stringify(res.json?.feedback));
  res = await request("admin", "GET", `/api/knowledge/articles?state=published&q=${encodeURIComponent(TAG)}`);
  check("the list shows it published with its helpfulness", res.json?.items?.some((a) => a.id === String(id) && a.helpfulness.score === 100), res.text.slice(0, 300));

  res = await request("approver", "POST", `${path}/actions`, { action: "retire", comment: "Superseded" });
  check("the reviewer retires it", res.status === 200 && res.json.state === "retired", message(res));
  check("the portal no longer lists it", (await portalHas()) === false);
  res = await request("reader", "POST", `/api/portal/faqs/${id}/feedback`, { helpful: true, comment: "" });
  check("nor takes votes on it (404)", res.status === 404, `${res.status}`);
}

/* ------------------------------------------------------------------------- *
 * Cleanup
 * ------------------------------------------------------------------------- */

async function cleanup() {
  for (const [cls, id] of created.reverse()) {
    const res = await request("admin", "DELETE", `/api/objects/${cls}/${id}?comment=${encodeURIComponent(TAG)}`);
    if (res.status !== 200) console.log(`  (could not delete ${cls} ${id}: ${res.status} ${res.text.slice(0, 120)})`);
  }
  for (const id of blackouts) await request("admin", "DELETE", `/api/admin/change-blackouts/${id}`);
  if (state.riskModel) await request("admin", "PUT", "/api/admin/change-risk", { model: state.riskModel });
  if (state.knowledgeSettings) {
    const { reviewerProfiles, reviewIntervalDays } = state.knowledgeSettings;
    await request("admin", "PUT", "/api/admin/knowledge-settings", { reviewerProfiles, reviewIntervalDays });
  }
  if (state.planRules) await request("admin", "PUT", "/api/admin/change-rules", { rules: state.planRules });

  // The BFF's own rows for the deleted records (risk answers, reviews, article state, votes).
  const env = readEnv();
  if (env.SESSION_STORE === "mysql" && documents.length) {
    const db = await createConnection({
      host: env.SESSION_DB_HOST || "127.0.0.1",
      port: Number(env.SESSION_DB_PORT || 3306),
      user: env.SESSION_DB_USER,
      password: env.SESSION_DB_PASSWORD,
      database: env.SESSION_DB_NAME,
    });
    try {
      let removed = 0;
      for (const [kind, key] of documents) {
        const [result] = await db.query(
          `DELETE FROM bff_documents WHERE tenant_id = '' AND kind = ? AND doc_key ${key.endsWith("%") ? "LIKE" : "="} ?`,
          [kind, key],
        );
        removed += result.affectedRows;
      }
      console.log(`  removed ${removed} BFF document rows`);
    } finally {
      await db.end();
    }
  }
}

try {
  await main();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.log(`  ABORT ${error.message}`);
} finally {
  if (sessions.admin) {
    try {
      await cleanup();
    } catch (error) {
      console.log(`  (cleanup: ${error.message})`);
    }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
