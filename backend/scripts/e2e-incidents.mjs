/**
 * Incidents end to end, against a running BFF, the local iTop with the
 * arcus-incident-extras extension, and the local Mailpit test mailbox.
 *
 * Signs in as a staff account, then:
 *   - on hold: an incident needs a reason and a next-action date (none, a
 *     malformed and a past date are refused); both read back on the record,
 *     in the list, and as overdue once the date has passed (the date is
 *     moved back in iTop directly, since the API rightly refuses a past
 *     one); a user request goes on hold through the generic record action
 *     the same way, and bulk holds are refused;
 *   - major incidents: the flag, the list filter, the dashboard's banner,
 *     child incidents linked and unlinked (iTop's parent_incident_id), a
 *     stakeholder update on the log of the major and its children and
 *     emailed to the callers and an extra address (checked in Mailpit);
 *   - email to ticket: a mail to the support address becomes an incident
 *     with its sender as caller and an acknowledgement carrying the ref; a
 *     reply with "[I-…]" in the subject lands on that incident's log without
 *     the quoted thread; an auto-reply is skipped; an unknown sender's mail
 *     is filed under the default organisation; nothing is filed twice.
 * Everything it creates in iTop is deleted at the end, pass or fail, and its
 * messages are removed from Mailpit.
 *
 *   npm run e2e:incidents                                   BFF on http://127.0.0.1:4010
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:incidents
 *
 * The BFF needs MAIL_INTAKE_SOURCE=mailpit and MAIL_INTAKE_ADDRESS (see
 * backend/README.md, "Email to ticket"), SMTP to Mailpit, and the account
 * must be an administrator (it starts intake runs through /api/admin/).
 *
 * The account: { "incidents": { "login", "password", "totpSecret" } } in
 * backend/e2e.local.json (git-ignored), MFA on; the first run enrols it and
 * saves the secret, as e2e-problems does. Or E2E_LOGIN / E2E_PASSWORD for a
 * BFF run with MFA_REQUIRED=off. The iTop service account in backend/.env
 * (ITOP_*) is used once, to move a next-action date into the past.
 */
import fs from "node:fs";
import http from "node:http";
import { createTransport } from "nodemailer";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const ENV_FILE = new URL("../.env", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4010");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5183";
const MAILPIT = (process.env.E2E_MAILPIT ?? "http://127.0.0.1:8025").replace(/\/+$/, "");
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 1025);
const STAMP = new Date().toISOString().slice(0, 19);
const TAG = `e2e-incidents ${STAMP}`;
/** Unique per run, so Mailpit searches only see this run's mail. */
const RUN = `run${Date.now().toString(36)}`;

/* ------------------------------------------------------------------------ */

const env = Object.fromEntries(
  (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
const SUPPORT = (process.env.E2E_SUPPORT_ADDRESS ?? env.MAIL_INTAKE_ADDRESS ?? "").toLowerCase();

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
} catch {
  config = {};
}
const account = process.env.E2E_LOGIN
  ? { login: process.env.E2E_LOGIN, password: process.env.E2E_PASSWORD ?? "", fromEnv: true }
  : config.incidents;
if (!account?.login || !account?.password) {
  console.error('Put { "incidents": { "login", "password" } } in backend/e2e.local.json, or set E2E_LOGIN and E2E_PASSWORD.');
  process.exit(2);
}
if (!SUPPORT) {
  console.error("No support address: set MAIL_INTAKE_ADDRESS in backend/.env (the BFF's) or E2E_SUPPORT_ADDRESS.");
  process.exit(2);
}

let cookie = "";
let passed = 0;
const failures = [];
/** [class, id], deleted in reverse order at the end. */
const created = [];

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

async function create(className, fields) {
  const res = await request("POST", `/api/objects/${className}`, { fields, comment: TAG });
  if (res.status !== 201) throw new Error(`create ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  const id = res.json.object.id;
  created.push([className, id]);
  return id;
}

/** Keeps the session cookie a response sets (sign-in, and again once MFA completes). */
function keepCookie(res) {
  const set = res.headers["set-cookie"];
  if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
}

const code = (secret) => totpAt(secret, timeStep(Date.now()));

/** Password, then (when the BFF asks) the MFA step: enrols, or answers with a code. */
async function signIn() {
  const login = await request("POST", "/api/auth/login", { login: account.login, password: account.password });
  if (login.status !== 200) throw new Error(`sign-in: ${login.status} ${login.text.slice(0, 200)}`);
  keepCookie(login);
  if (login.json.user) {
    check("signed in (this BFF asks no MFA)", true);
    return login.json.user;
  }
  if (account.fromEnv) throw new Error("this BFF asks for MFA: use backend/e2e.local.json, or MFA_REQUIRED=off");

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
  // A code is accepted once: if the last run used this 30-second step, wait for the next.
  for (const attempt of [0, 1]) {
    if (attempt) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
    const verify = await request("POST", "/api/auth/mfa/verify", { code: code(account.totpSecret) });
    if (verify.status === 200) {
      keepCookie(verify);
      check("signed in with password and a TOTP code", Boolean(verify.json.user));
      return verify.json.user;
    }
    if (attempt) throw new Error(`MFA code refused: ${verify.status} ${verify.text.slice(0, 200)}`);
  }
}

/** iTop's REST API as the service account: only to move a next-action date into the past. */
async function itopUpdate(className, id, fields) {
  const body = new URLSearchParams({
    version: "1.4",
    auth_user: env.ITOP_USER ?? "",
    auth_pwd: env.ITOP_PASSWORD ?? "",
    json_data: JSON.stringify({ operation: "core/update", class: className, key: Number(id), fields, comment: TAG }),
  });
  const res = await fetch(`${env.ITOP_BASE_URL ?? "http://localhost:8080"}/webservices/rest.php`, { method: "POST", body });
  return res.json();
}

/* --- Mailpit ------------------------------------------------------------- */

const smtp = createTransport({ host: "127.0.0.1", port: SMTP_PORT, secure: false, ignoreTLS: true });
const mailIds = new Set();

async function mailpit(path, init) {
  const res = await fetch(`${MAILPIT}${path}`, init);
  if (!res.ok) throw new Error(`Mailpit ${path}: HTTP ${res.status}`);
  return res.status === 204 ? undefined : res.json().catch(() => undefined);
}

async function sendMail({ from, subject, text, headers = {} }) {
  await smtp.sendMail({ from, to: SUPPORT, subject, text, headers });
}

/** This run's messages matching a Mailpit query, after a short wait for delivery. */
async function findMail(query, { want = 1, tries = 10 } = {}) {
  for (let i = 0; i < tries; i++) {
    const found = await mailpit(`/api/v1/search?query=${encodeURIComponent(query)}&limit=50`);
    const messages = found?.messages ?? [];
    for (const m of messages) mailIds.add(m.ID);
    if (messages.length >= want) return messages;
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

const runIntake = async () => {
  const res = await request("POST", "/api/admin/mail-intake/run");
  if (res.status !== 200) throw new Error(`intake run: ${res.status} ${res.text.slice(0, 300)}`);
  return res.json;
};

/* ------------------------------------------------------------------------ */

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const logText = (incident) => incident.log.map((e) => e.message).join("\n");

async function main() {
  const user = await signIn();
  const orgId = Number(user.orgId || 1);

  console.log("\nSetup");
  // A team with a member: iTop accepts as agent only someone in the ticket's team.
  const member = await request("GET", "/api/objects/lnkPersonToTeam?limit=1&fields=team_id,person_id");
  const teamId = String(member.json?.items?.[0]?.fields?.team_id ?? "");
  const agentId = String(member.json?.items?.[0]?.fields?.person_id ?? "");
  if (!teamId || !agentId) throw new Error("this iTop has no team with a member; add one first");
  const callerEmail = `caller.${RUN}@example.com`;
  const callerId = String(
    await create("Person", { name: "Caller", first_name: `E2E ${RUN}`, email: callerEmail, org_id: orgId }),
  );
  console.log(`  team ${teamId}, agent ${agentId}, caller ${callerId} <${callerEmail}>`);

  const newIncident = async (title, extra = {}) => {
    const res = await request("POST", "/api/incidents", {
      title: `${TAG} ${title}`,
      description: `${title}, made by the incidents e2e script.`,
      organizationId: String(orgId),
      callerId,
      teamId,
      ...extra,
    });
    if (res.status !== 201) throw new Error(`create incident: ${res.status} ${res.text.slice(0, 300)}`);
    created.push(["Incident", Number(res.json.id)]);
    return res.json;
  };

  /* --- On hold ---------------------------------------------------------- */
  console.log("\nOn hold");
  const held = await newIncident("waiting for the vendor");
  let res = await request("POST", `/api/incidents/${held.id}/transitions`, { action: "assign", agentId });
  check("incident assigned", res.status === 200 && res.json.status === "open", `${res.status} ${res.text.slice(0, 200)}`);
  check("detail says the extension is there", res.json?.extrasAvailable === true, `${res.json?.extrasAvailable}`);

  res = await request("POST", `/api/incidents/${held.id}/transitions`, { action: "hold", pendingReason: "Vendor" });
  check("hold without a next-action date refused (400)", res.status === 400, `${res.status}`);
  res = await request("POST", `/api/incidents/${held.id}/transitions`, {
    action: "hold",
    pendingReason: "Vendor",
    nextActionDate: day(-1),
  });
  check("hold with a past date refused (400)", res.status === 400, `${res.status}`);
  res = await request("POST", `/api/incidents/${held.id}/transitions`, {
    action: "hold",
    pendingReason: "Vendor",
    nextActionDate: "2026-02-30",
  });
  check("hold with an impossible date refused (400)", res.status === 400, `${res.status}`);

  const due = day(3);
  res = await request("POST", `/api/incidents/${held.id}/transitions`, {
    action: "hold",
    pendingReason: "Waiting for the vendor's patch",
    nextActionDate: due,
    comment: "Asked the vendor for an ETA",
  });
  check("incident put on hold", res.status === 200 && res.json.status === "pending", `${res.status} ${res.text.slice(0, 200)}`);
  check(
    "reason and next-action date read back on the record",
    res.json?.pending?.reason === "Waiting for the vendor's patch" &&
      res.json?.pending?.nextActionDate === due &&
      res.json?.pending?.overdue === false,
    JSON.stringify(res.json?.pending),
  );

  res = await request("GET", `/api/incidents?q=${encodeURIComponent(held.ref)}`);
  const row = res.json?.items?.find((i) => i.id === held.id);
  check("list row carries the hold", row?.pending?.nextActionDate === due, JSON.stringify(row?.pending));

  const back = await itopUpdate("Incident", held.id, { next_action_date: day(-2) });
  check("next-action date moved into the past in iTop", back.code === 0, JSON.stringify(back).slice(0, 200));
  res = await request("GET", `/api/incidents/${held.id}`);
  check("record now reads overdue", res.json?.pending?.overdue === true, JSON.stringify(res.json?.pending));
  res = await request("GET", "/api/incidents?overdue=true&limit=200");
  check(
    "overdue filter lists it",
    res.status === 200 && res.json.items.some((i) => i.id === held.id && i.pending?.overdue),
    `${res.status} ${res.json?.total}`,
  );
  res = await request("GET", `/api/incidents?overdue=true&q=${encodeURIComponent(TAG)}`);
  check(
    "overdue filter leaves out incidents not on hold",
    res.status === 200 && res.json.items.every((i) => i.status === "pending"),
    `${res.json?.items?.map((i) => i.status)}`,
  );

  // My Assignments, when the signed-in account's own person can take the incident.
  const mine = await request("GET", `/api/objects/lnkPersonToTeam?limit=1&fields=team_id&person_id=${user.contactId ?? 0}`);
  const myTeam = String(mine.json?.items?.[0]?.fields?.team_id ?? "");
  if (user.contactId && myTeam) {
    const own = await newIncident("my own overdue hold", { teamId: myTeam });
    await request("POST", `/api/incidents/${own.id}/transitions`, { action: "assign", agentId: String(user.contactId) });
    await request("POST", `/api/incidents/${own.id}/transitions`, {
      action: "hold",
      pendingReason: "Waiting for the caller",
      nextActionDate: day(1),
    });
    await itopUpdate("Incident", own.id, { next_action_date: day(-1) });
    res = await request("GET", "/api/dashboard/overview?range=7d");
    const queue = res.json?.myAssignments?.incidents?.items ?? [];
    check(
      "My Assignments shows the overdue hold first",
      queue[0]?.id === own.id && queue[0]?.pending?.overdue === true,
      JSON.stringify(queue.slice(0, 2)),
    );
  } else {
    console.log("  (the signed-in account's person is in no team: My Assignments not checked)");
  }

  // A user request through the generic record action.
  const requestId = await create("UserRequest", {
    org_id: orgId,
    caller_id: Number(callerId),
    title: `${TAG} request on hold`,
    description: "<p>A request the e2e script puts on hold</p>",
    team_id: Number(teamId),
  });
  res = await request("POST", `/api/objects/UserRequest/${requestId}/stimulus`, {
    stimulus: "ev_assign",
    fields: { team_id: Number(teamId), agent_id: Number(agentId) },
  });
  check("user request assigned", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
  res = await request("POST", `/api/objects/UserRequest/${requestId}/stimulus`, {
    stimulus: "ev_pending",
    fields: { pending_reason: "Waiting for approval from finance" },
  });
  check("user request hold without a date refused (400)", res.status === 400, `${res.status}`);
  res = await request("POST", "/api/objects/UserRequest/bulk", {
    action: "stimulus",
    ids: [requestId],
    stimulus: "ev_pending",
    fields: { pending_reason: "x" },
  });
  check("bulk hold refused (400)", res.status === 400, `${res.status}`);
  res = await request("POST", `/api/objects/UserRequest/${requestId}/stimulus`, {
    stimulus: "ev_pending",
    fields: { pending_reason: "Waiting for approval from finance", next_action_date: day(5) },
  });
  check(
    "user request put on hold with a date",
    res.status === 200 && res.json?.fields?.status === "pending",
    `${res.status} ${res.text.slice(0, 200)}`,
  );
  res = await request("GET", `/api/tickets/UserRequest/${requestId}/pending`);
  check(
    "user request hold reads back",
    res.json?.pending?.reason === "Waiting for approval from finance" && res.json?.pending?.nextActionDate === day(5),
    res.text.slice(0, 200),
  );

  /* --- Major incidents -------------------------------------------------- */
  console.log("\nMajor incidents");
  const major = await newIncident("email down for everyone");
  const childA = await newIncident("cannot send mail");
  const childB = await newIncident("outlook keeps asking for a password");

  res = await request("POST", `/api/incidents/${major.id}/stakeholder-updates`, { message: "too early" });
  check("stakeholder update refused before the incident is major (400)", res.status === 400, `${res.status}`);

  res = await request("PUT", `/api/incidents/${major.id}/major`, { major: true });
  check("declared major", res.status === 200 && res.json.major === true, `${res.status} ${res.text.slice(0, 200)}`);
  res = await request("GET", "/api/incidents?major=true&limit=200");
  check("major filter lists it", res.json?.items?.some((i) => i.id === major.id && i.major), `${res.json?.total}`);
  res = await request("GET", "/api/incidents/major");
  check("open major incidents list it", res.json?.items?.some((i) => i.id === major.id), res.text.slice(0, 200));
  res = await request("GET", "/api/dashboard/overview?range=7d");
  check(
    "dashboard banner lists it",
    res.json?.majorIncidents?.some((i) => i.id === major.id),
    JSON.stringify(res.json?.majorIncidents ?? null).slice(0, 200),
  );

  res = await request("POST", `/api/incidents/${major.id}/children`, { incidentIds: [major.id] });
  check("linking an incident to itself refused (400)", res.status === 400, `${res.status}`);
  res = await request("POST", `/api/incidents/${major.id}/children`, { incidentIds: [childA.id, childB.id] });
  check(
    "two child incidents linked",
    res.status === 200 && res.json.childIncidents?.length === 2,
    `${res.status} ${res.text.slice(0, 200)}`,
  );
  res = await request("GET", `/api/incidents/${childA.id}`);
  check("the child names its major incident", res.json?.parentIncident?.id === major.id, JSON.stringify(res.json?.parentIncident));

  const message = `Mail is failing over to the standby cluster (${RUN}); next update at 14:00.`;
  res = await request("POST", `/api/incidents/${major.id}/stakeholder-updates`, {
    message,
    postToChildren: true,
    notifyCallers: true,
    notifyEmails: [`stakeholder.${RUN}@example.com`],
  });
  check(
    "stakeholder update posted to both children",
    res.status === 200 && res.json.postedTo === 2,
    `${res.status} ${res.text.slice(0, 300)}`,
  );
  check(
    "emailed the caller and the extra address",
    res.json?.notified?.includes(callerEmail) && res.json?.notified?.includes(`stakeholder.${RUN}@example.com`),
    JSON.stringify(res.json?.notified),
  );
  check("major incident's log has the update", logText(res.json?.incident ?? { log: [] }).includes(message));
  res = await request("GET", `/api/incidents/${childB.id}`);
  check("child's log has the update, with the major's ref", logText(res.json).includes(`${major.ref} Stakeholder update`));
  let mails = await findMail(`to:"stakeholder.${RUN}@example.com"`);
  check(
    "stakeholder email arrived in Mailpit, ref in brackets",
    mails[0]?.Subject?.startsWith(`[${major.ref}] Update:`),
    mails[0]?.Subject ?? "none",
  );
  mails = await findMail(`to:"${callerEmail}" subject:"Update:"`);
  check("caller's copy arrived", mails.length >= 1, `${mails.length}`);

  res = await request("DELETE", `/api/incidents/${major.id}/children/${childB.id}`);
  check("child unlinked", res.status === 200 && res.json.childIncidents?.length === 1, `${res.status}`);
  res = await request("PUT", `/api/incidents/${major.id}/major`, { major: false });
  check("major flag cleared", res.status === 200 && res.json.major === false, `${res.status}`);

  /* --- Email to ticket -------------------------------------------------- */
  console.log("\nEmail to ticket");
  res = await request("GET", "/api/admin/mail-intake");
  check("intake is on, reading Mailpit", res.json?.enabled === true && res.json?.source === "mailpit", res.text.slice(0, 200));

  const subject = `Printer on floor 2 jammed ${RUN}`;
  await sendMail({ from: `E2E Caller <${callerEmail}>`, subject, text: "It jams on every page.\nPlease help." });
  await findMail(`to:"${SUPPORT}" subject:"${RUN}"`);
  let run = await runIntake();
  let outcome = run.outcomes.find((o) => o.subject === subject);
  check("the email became an incident", outcome?.action === "created" && Boolean(outcome?.ref), JSON.stringify(run).slice(0, 300));
  const mailIncidentId = outcome?.incidentId;
  if (mailIncidentId) created.push(["Incident", Number(mailIncidentId)]);
  res = await request("GET", `/api/incidents/${mailIncidentId}`);
  check(
    "filed with the sender as caller, origin mail, the subject as title",
    res.json?.caller?.id === callerId && res.json?.origin === "mail" && res.json?.summary === subject,
    JSON.stringify({ caller: res.json?.caller, origin: res.json?.origin, summary: res.json?.summary }),
  );
  check("the body is the description", String(res.json?.description).includes("It jams on every page."));
  mails = await findMail(`to:"${callerEmail}" subject:"[${outcome?.ref}]"`);
  check("the sender got an acknowledgement with the ref", mails.length >= 1, `${mails.length}`);

  await sendMail({
    from: callerEmail,
    subject: `RE: [${outcome?.ref}] ${subject}`,
    text: `Now it also smells burnt.\n\nOn Mon, the service desk wrote:\n> We have logged your email as ${outcome?.ref}.`,
  });
  await sendMail({
    from: callerEmail,
    subject: `Out of office ${RUN}`,
    text: "I am away.",
    headers: { "Auto-Submitted": "auto-replied" },
  });
  const strangerSubject = `Who handles badges ${RUN}`;
  await sendMail({ from: `stranger.${RUN}@else.example`, subject: strangerSubject, text: "My badge stopped working." });
  await findMail(`to:"${SUPPORT}" subject:"${RUN}" is:unread`, { want: 3 });
  run = await runIntake();
  const byAction = (action) => run.outcomes.filter((o) => o.action === action);
  check("the reply was added to its incident", byAction("updated").some((o) => o.incidentId === mailIncidentId), JSON.stringify(run.outcomes));
  check("the auto-reply was skipped", byAction("skipped").some((o) => o.subject === `Out of office ${RUN}`));
  const stranger = byAction("created").find((o) => o.subject === strangerSubject);
  if (stranger?.incidentId) created.push(["Incident", Number(stranger.incidentId)]);
  check("the unknown sender's mail was filed", Boolean(stranger?.ref), JSON.stringify(stranger));
  res = await request("GET", `/api/incidents/${mailIncidentId}`);
  const log = logText(res.json);
  check("the reply is on the log, without the quoted thread", log.includes("Now it also smells burnt.") && !log.includes("We have logged"), log.slice(0, 300));
  if (stranger?.incidentId) {
    res = await request("GET", `/api/incidents/${stranger.incidentId}`);
    check(
      "the unknown sender is named in the description, no caller",
      !res.json?.caller && String(res.json?.description).includes(`stranger.${RUN}@else.example`),
      JSON.stringify({ caller: res.json?.caller }),
    );
  }
  run = await runIntake();
  check(
    "a second run files nothing again",
    !run.outcomes.some((o) => o.subject.includes(RUN) && (o.action === "created" || o.action === "updated")),
    JSON.stringify(run.outcomes).slice(0, 300),
  );
}

async function cleanup() {
  console.log("\nCleanup");
  for (const [className, id] of created.reverse()) {
    const res = await request("DELETE", `/api/objects/${className}/${id}?comment=${encodeURIComponent(TAG)}`);
    console.log(`  delete ${className} ${id}: ${res.status}`);
  }
  // This run's mail, and the acknowledgements and updates sent for it.
  await findMail(RUN, { tries: 1 }).catch(() => []);
  if (mailIds.size) {
    await mailpit("/api/v1/messages", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: [...mailIds] }),
    }).catch((e) => console.log(`  (Mailpit cleanup: ${e.message})`));
    console.log(`  removed ${mailIds.size} messages from Mailpit`);
  }
  smtp.close();
}

try {
  await main();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.log(`\n  ABORTED  ${error.stack ?? error.message}`);
} finally {
  await cleanup().catch((e) => console.log(`  cleanup failed: ${e.message}`));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
