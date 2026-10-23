// End-to-end check of approvals, against a running BFF, its iTop (with the
// approval extension installed) and Mailpit. Nothing is mocked:
//
//   end user raises a request in the portal
//     -> the extension asks level 1 (an end user) by email, with our link
//     -> level 1 approves in the platform -> level 2 (staff) is emailed and
//        gets a bell entry -> level 2 rejects with a comment
//     -> the request is rejected, the requester is emailed, the portal shows why
//   and a second request approved at both levels ends approved, requester emailed.
//
//   node scripts/e2e-approvals.mjs
//
// Needs: the BFF (E2E_BFF_URL, default http://127.0.0.1:4030/api) on an iTop
// with the extension and `npm run approvals:setup` done, iTop's cron running
// (the bell entries are queued), and Mailpit (E2E_MAILPIT_URL, default
// http://localhost:8025). The administrator is ITOP_USER / ITOP_PASSWORD from
// backend/.env; it also makes the fixtures iTop's REST API holds and the
// platform does not expose (approval rule, coverage window). Accounts
// e2e.requester, e2e.approver (end users) and e2e.manager (staff) are created
// once and get fresh random passwords on every run.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const BFF = process.env.E2E_BFF_URL ?? "http://127.0.0.1:4030/api";
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^"(.*)"$/, "$1")]),
);
const ITOP = process.env.ITOP_BASE_URL ?? env.ITOP_BASE_URL;
const ADMIN = { login: process.env.ITOP_USER ?? env.ITOP_USER, password: process.env.ITOP_PASSWORD ?? env.ITOP_PASSWORD };
const STAMP = new Date().toISOString().replace(/\D/g, "").slice(2, 12);

let passed = 0;
let failed = 0;
async function step(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` -- ${detail}` : ""} (${Date.now() - started}ms)`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n          ${error.message}`);
    // Later steps build on this one: stop here.
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }
}
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(what, fn, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await sleep(2_000);
  }
}

/** A BFF session (cookie jar of one). */
class Session {
  cookie = "";
  async call(method, path, body, { expect } = {}) {
    const response = await fetch(`${BFF}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (expect !== undefined) {
      check(response.status === expect, `${method} ${path}: expected ${expect}, got ${response.status} ${text.slice(0, 200)}`);
      return json;
    }
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
    return json;
  }
  static async signIn(login, password) {
    const s = new Session();
    s.user = (await s.call("POST", "/auth/login", { login, password })).user;
    return s;
  }
}

/** iTop's REST API, as the administrator: only for fixtures the platform does not expose. */
async function itop(operation, params) {
  const body = new URLSearchParams({
    version: "1.4",
    auth_user: ADMIN.login,
    auth_pwd: ADMIN.password,
    json_data: JSON.stringify({ operation, comment: "e2e-approvals fixture", ...params }),
  });
  const result = await (await fetch(`${ITOP}/webservices/rest.php`, { method: "POST", body })).json();
  if (result.code !== 0) throw new Error(`iTop ${operation} ${params.class}: ${result.message}`);
  return Object.values(result.objects ?? {});
}
async function upsert(cls, oql, fields) {
  const [found] = await itop("core/get", { class: cls, key: oql, output_fields: "id", limit: 1 });
  const [row] = found
    ? await itop("core/update", { class: cls, key: found.key, fields, output_fields: "id" })
    : await itop("core/create", { class: cls, fields, output_fields: "id" });
  return Number(row.key);
}

async function mails(to, subjectPart) {
  const query = encodeURIComponent(`to:${to} subject:"${subjectPart}"`);
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${query}&limit=5`)).json();
  return list.messages ?? [];
}
async function mailBody(id) {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()).HTML ?? "";
}

/* ------------------------------------------------------------------------ */

console.log(`Approvals e2e against ${BFF} (iTop ${ITOP}, Mailpit ${MAILPIT}), stamp ${STAMP}`);
const admin = await Session.signIn(ADMIN.login, ADMIN.password);
const orgId = admin.user.orgId;
const people = {};

await step("accounts: requester and level-1 approver (end users), level-2 approver (staff)", async () => {
  const { profiles } = await admin.call("GET", "/admin/profiles");
  const profile = (name) => profiles.find((p) => p.name === name)?.id;
  const wanted = [
    ["requester", "e2e.requester", "Rae", "Requester", "Portal user"],
    ["approver", "e2e.approver", "Abe", "Approver", "Portal user"],
    ["manager", "e2e.manager", "Mia", "Manager", "Support Agent"],
  ];
  for (const [key, login, first, last, profileName] of wanted) {
    const password = `E2e-${randomBytes(12).toString("base64url")}-9a`;
    const email = `${login}@example.test`;
    const { items } = await admin.call("GET", `/admin/users?q=${encodeURIComponent(login)}`);
    let user = items.find((u) => u.login === login);
    if (user) {
      if (user.status !== "enabled") await admin.call("PATCH", `/admin/users/${user.id}`, { status: "enabled" });
      await admin.call("POST", `/admin/users/${user.id}/password`, { password });
    } else {
      await admin.call("POST", "/admin/users", {
        type: "local",
        login,
        password,
        contact: { firstName: first, lastName: last, email, orgId },
        profileIds: [profile(profileName)],
      });
    }
    const session = await Session.signIn(login, password);
    people[key] = { login, password, email, contactId: session.user.contactId, session };
  }
  return Object.entries(people).map(([k, p]) => `${k}=${p.login}#${p.contactId}`).join(", ");
});

let subcategoryId;
await step("fixtures: a two-level approval rule on a subcategory of the catalogue", async () => {
  const intervals = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((weekday) => ({
    weekday,
    start_time: "00:00",
    end_time: "24:00",
  }));
  const windowId = await upsert("CoverageWindow", "SELECT CoverageWindow WHERE name = 'E2E 24x7'", {
    name: "E2E 24x7",
    interval_list: intervals,
  });
  const ruleId = await upsert("ApprovalRule", "SELECT ApprovalRule WHERE name = 'E2E approvals'", {
    name: "E2E approvals",
    coveragewindow_id: windowId,
    level1_rule: `SELECT Person WHERE id = ${people.approver.contactId}`,
    level1_default_approval: "no",
    level1_timeout: "0",
    level1_exit_condition: "first_reply",
    level2_rule: `SELECT Person WHERE id = ${people.manager.contactId}`,
    level2_default_approval: "no",
    level2_timeout: "0",
    level2_exit_condition: "first_reply",
  });
  const { services } = await people.requester.session.call("GET", "/portal/catalog");
  check(services.length > 0, "The requester's portal catalogue is empty; give their organisation a customer contract.");
  subcategoryId = await upsert("ServiceSubcategory", "SELECT ServiceSubcategory WHERE name = 'E2E needs approval'", {
    name: "E2E needs approval",
    service_id: services[0].id,
    request_type: "service_request",
    status: "production",
    approvalrule_id: ruleId,
  });
  people.serviceId = services[0].id;
  return `rule #${ruleId}, subcategory #${subcategoryId} under "${services[0].name}"`;
});

async function raise(title) {
  const created = await people.requester.session.call("POST", "/portal/requests", {
    title,
    description: `Raised by e2e-approvals ${STAMP}.`,
    serviceId: people.serviceId,
    subcategoryId,
  });
  return created;
}

async function approvalFor(session, ref) {
  const { items } = await session.call("GET", "/me/approvals?state=pending");
  return items.find((a) => a.request.ref === ref);
}

/* --- Request 1: approved at level 1, rejected at level 2 ------------------ */

let first;
let approval;
await step("requester raises a request; it waits for approval", async () => {
  first = await raise(`E2E ${STAMP} laptop for a new hire`);
  const detail = await people.requester.session.call("GET", `/portal/requests/${first.id}`);
  check(detail.status === "awaiting_approval", `status is ${detail.status}`);
  return `${detail.ref} is ${detail.status}`;
});

await step("level 1 is emailed, with a link into the platform", async () => {
  const [mail] = await eventually("the approval email", () => mails(people.approver.email, first.ref));
  const html = await mailBody(mail.ID);
  const link = /href="([^"]*\/approvals\/(\d+))"/.exec(html);
  check(link, "no /approvals/<id> link in the email");
  check(!/approve\.php/.test(html), "the email links to iTop's approval page");
  return `"${mail.Subject}" -> ${link[1]}`;
});

await step("level 1 sees it waiting, can open it; the others cannot answer", async () => {
  const count = await people.approver.session.call("GET", "/me/approvals/count");
  check(count.pending >= 1, `count ${count.pending}`);
  approval = await approvalFor(people.approver.session, first.ref);
  check(approval?.awaitingMe && approval.level === 1 && approval.levels === 2, "not listed as waiting at level 1 of 2");
  const detail = await people.approver.session.call("GET", `/me/approvals/${approval.id}`);
  check(detail.request.title.includes(STAMP) && detail.steps.length === 2, "detail is missing the request or levels");
  await people.requester.session.call("GET", `/me/approvals/${approval.id}`, undefined, { expect: 404 });
  await people.manager.session.call("POST", `/me/approvals/${approval.id}/approve`, {}, { expect: 409 });
  await people.approver.session.call("GET", `/approvals/requests/${first.id}`, undefined, { expect: 403 });
  return `approval #${approval.id}`;
});

await step("level 1 must give a reason to reject, then approves with a comment", async () => {
  await people.approver.session.call("POST", `/me/approvals/${approval.id}/reject`, { comment: " " }, { expect: 400 });
  const after = await people.approver.session.call("POST", `/me/approvals/${approval.id}/approve`, { comment: "Budget is fine." });
  check(after.status === "pending" && after.level === 2, `status ${after.status}, level ${after.level}`);
  check(after.myAnswer?.decision === "approved", "my answer not recorded");
  await people.approver.session.call("POST", `/me/approvals/${approval.id}/approve`, {}, { expect: 409 });
  return "now at level 2";
});

await step("level 2 is emailed, and its bell offers the approval", async () => {
  await eventually("the level-2 email", () => mails(people.manager.email, first.ref));
  const item = await eventually(
    "the bell entry (queued; iTop's cron sends it)",
    async () => (await people.manager.session.call("GET", "/me/notifications?limit=20")).items.find((i) => i.approval === approval.id),
    180_000,
  );
  return `bell: "${item.title}"`;
});

await step("level 2 rejects with a comment; the request is rejected", async () => {
  const pending = await approvalFor(people.manager.session, first.ref);
  check(pending?.id === approval.id, "not waiting for level 2");
  const after = await people.manager.session.call("POST", `/me/approvals/${approval.id}/reject`, { comment: `Over budget ${STAMP}` });
  check(after.status === "rejected", `approval is ${after.status}`);
  const staffView = await people.manager.session.call("GET", `/approvals/requests/${first.id}`);
  check(staffView.approval?.status === "rejected", "staff request view does not show the rejection");
  const { items } = await people.manager.session.call("GET", "/me/approvals?state=decided");
  check(items.some((a) => a.id === approval.id && a.myAnswer?.decision === "rejected"), "not in 'decided by me'");
  return "rejected";
});

await step("the requester is told, and sees who decided what", async () => {
  const detail = await people.requester.session.call("GET", `/portal/requests/${first.id}`);
  check(detail.status === "rejected", `status ${detail.status}`);
  const { approval: shown } = await people.requester.session.call("GET", `/portal/requests/${first.id}/approval`);
  const answers = shown.steps.flatMap((s) => s.approvers.map((a) => `${a.decision}:${a.comment}`));
  check(answers.includes("approved:Budget is fine.") && answers.includes(`rejected:Over budget ${STAMP}`), answers.join(" | "));
  const [mail] = await eventually("the 'rejected' email", () => mails(people.requester.email, `${first.ref} was rejected`));
  return `"${mail.Subject}"`;
});

/* --- Request 2: approved at both levels ---------------------------------- */

await step("a second request approved at both levels ends approved", async () => {
  const second = await raise(`E2E ${STAMP} software licence`);
  const one = await eventually("level 1's approval", () => approvalFor(people.approver.session, second.ref));
  await people.approver.session.call("POST", `/me/approvals/${one.id}/approve`, {});
  const two = await eventually("level 2's approval", () => approvalFor(people.manager.session, second.ref));
  const after = await people.manager.session.call("POST", `/me/approvals/${two.id}/approve`, { comment: "OK" });
  check(after.status === "approved", `approval is ${after.status}`);
  const detail = await people.requester.session.call("GET", `/portal/requests/${second.id}`);
  check(detail.status === "approved", `request is ${detail.status}`);
  const [mail] = await eventually("the 'approved' email", () => mails(people.requester.email, `${second.ref} was approved`));
  return `${second.ref}: "${mail.Subject}"`;
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
