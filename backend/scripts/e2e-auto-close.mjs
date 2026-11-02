/**
 * Auto-close end to end, against a real iTop (ITOP_* in backend/.env) and
 * the BFF's mail server (Mailpit locally):
 *
 *   - stock iTop refuses ev_autoclose on a resolved ticket (no transition),
 *     so the job closes with ev_close;
 *   - a check 6 days after resolution emails each caller once, with the
 *     closing day and the portal link; a second check sends nothing more;
 *   - a check 8 days after resolution closes the request and the incident,
 *     with the note in their public log, as the service account;
 *   - one the customer confirmed (closed) in the meantime is left alone;
 *   - closed is final: ev_reopen is refused.
 *
 * The job runs in-process (AutoCloseService, through the tenant guard) with
 * its clock moved forward, scoped to one organisation of its own so no other
 * ticket in this iTop is touched. Tickets it raises are deleted at the end,
 * pass or fail; the organisation and the caller are kept for the next run.
 *
 *   npm run e2e:auto-close
 */
import { loadConfig } from "../src/config/env.ts";
import { runAs, runAsServiceAccount } from "../src/core/request-context.ts";
import { ItopClient } from "../src/itop/client.ts";
import { normalizeObjects } from "../src/itop/normalize.ts";
import { AutoCloseService } from "../src/modules/auto-close/index.ts";
import { SmtpMailer } from "../src/platform/auth/mailer.ts";
import { TenantScopedClient } from "../src/platform/tenancy/scoped-client.ts";
import { CmdbSchema } from "../src/schema/load.ts";
import { MemoryDocStore } from "../src/shared/doc-store.ts";

const MAILPIT = process.env.E2E_MAILPIT ?? "http://localhost:8025";
const ORG_NAME = "E2E auto-close";
const CALLER_EMAIL = "e2e.autoclose.caller@example.test";
const DAY = 86_400_000;

const config = loadConfig();
const schema = CmdbSchema.fromFile(config.schemaPath);
const raw = new ItopClient(config);
const client = new TenantScopedClient(raw, schema).asClient();
const reset = config.auth.passwordReset;
const mailer = reset ? new SmtpMailer(reset) : undefined;

let passed = 0;
const failures = [];
/** [class, id], deleted at the end. */
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

const itop = (verb, params) => raw.call(verb, { comment: "e2e-auto-close", ...params });
const rows = async (cls, key, fields) =>
  normalizeObjects((await itop("core/get", { class: cls, key, output_fields: fields })).objects);

async function findOrMake(cls, key, fields) {
  const found = await rows(cls, key, "id");
  if (found[0]) return found[0].id;
  return normalizeObjects((await itop("core/create", { class: cls, fields, output_fields: "id" })).objects)[0].id;
}

async function mails(to) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`);
  if (!res.ok) return [];
  return (await res.json()).messages ?? [];
}

async function ticket(cls, orgId, callerId, title) {
  const id = normalizeObjects(
    (
      await itop("core/create", {
        class: cls,
        fields: { org_id: orgId, caller_id: callerId, title, description: "Raised by e2e-auto-close" },
        output_fields: "id",
      })
    ).objects,
  )[0].id;
  created.push([cls, id]);
  await itop("core/apply_stimulus", {
    class: cls,
    key: id,
    stimulus: "ev_autoresolve",
    fields: { solution: "Fixed by e2e-auto-close", resolution_code: "other" },
    output_fields: "id",
  });
  return id;
}

async function main() {
  if (!mailer) throw new Error("No mail server in backend/.env (SMTP_HOST, MAIL_FROM): the reminder cannot be checked.");
  const orgId = await findOrMake("Organization", `SELECT Organization WHERE name = '${ORG_NAME}'`, { name: ORG_NAME });
  const callerId = await findOrMake("Person", `SELECT Person WHERE email = '${CALLER_EMAIL}'`, {
    name: "Caller",
    first_name: "Autoclose",
    org_id: orgId,
    email: CALLER_EMAIL,
  });
  const scope = { key: "e2e", tenant: { id: "e2e", name: ORG_NAME, orgIds: [orgId] } };

  const stamp = new Date().toISOString().slice(0, 19);
  const request = await ticket("UserRequest", orgId, callerId, `Auto-close request ${stamp}`);
  const incident = await ticket("Incident", orgId, callerId, `Auto-close incident ${stamp}`);
  const confirmed = await ticket("UserRequest", orgId, callerId, `Auto-close confirmed ${stamp}`);
  const resolvedAt = Date.now();

  const autoClose = await raw.callRaw("core/apply_stimulus", {
    class: "UserRequest",
    key: request,
    stimulus: "ev_autoclose",
    fields: {},
    output_fields: "id",
    comment: "e2e-auto-close",
  });
  check("stock iTop refuses ev_autoclose on a resolved ticket", autoClose.code !== 0 && /Invalid stimulus/.test(autoClose.message));

  const service = (offsetDays) =>
    new AutoCloseService(
      client,
      schema,
      new MemoryDocStore(),
      async () => [scope],
      config.itop.timezone,
      config.appBaseUrl ?? "",
      0,
      mailer,
      undefined,
      () => resolvedAt + offsetDays * DAY,
    );

  // "Run now" as the scope's administrator would: bound to its tenant.
  const run = (svc) => runAs(undefined, () => svc.runCurrent(), scope.tenant);

  // Six days on: inside the 2-day reminder window.
  const sixDays = service(6);
  const first = { lastRun: await run(sixDays) };
  const reminded = (first.lastRun?.outcomes ?? []).filter((o) => o.action === "reminded").map((o) => Number(o.id));
  check(
    "6 days after: each caller is reminded",
    [request, incident, confirmed].every((id) => reminded.includes(id)),
    JSON.stringify(first.lastRun),
  );
  check("6 days after: nothing closed yet", !(first.lastRun?.outcomes ?? []).some((o) => o.action === "closed"));
  await new Promise((r) => setTimeout(r, 1500));
  const sent = await mails(CALLER_EMAIL);
  const requestRef = (await rows("UserRequest", request, "ref"))[0].fields.ref;
  const mail = sent.find((m) => m.Subject.startsWith(`[${requestRef}]`));
  check("the reminder reached Mailpit with the ref in the subject", Boolean(mail), sent.map((m) => m.Subject).join(" | "));
  if (mail) {
    const body = await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json();
    check("the reminder names the closing day and links the portal", /closes by itself on \w+, \d+ \w+ \d{4}/.test(body.Text) && body.Text.includes(`/portal/requests/${request}`));
  }
  check("a second check sends no second reminder", (await run(sixDays)).outcomes.length === 0);

  // The customer confirms one before the deadline.
  await itop("core/apply_stimulus", { class: "UserRequest", key: confirmed, stimulus: "ev_close", fields: {}, output_fields: "id" });

  // Eight days on: past the 7-day delay.
  const eightDays = service(8);
  const outcomes = (await run(eightDays)).outcomes;
  const closedIds = outcomes.filter((o) => o.action === "closed").map((o) => Number(o.id));
  check("8 days after: the request and the incident close", closedIds.includes(request) && closedIds.includes(incident), JSON.stringify(outcomes));
  check("the ticket the customer confirmed is left alone", !outcomes.some((o) => Number(o.id) === confirmed));

  for (const [cls, id] of [["UserRequest", request], ["Incident", incident]]) {
    const f = (await rows(cls, id, "status,close_date,public_log"))[0].fields;
    const log = JSON.stringify(f.public_log);
    check(`${cls} ${id} is closed, with a close date`, f.status === "closed" && Boolean(f.close_date), f.status);
    check(`${cls} ${id} has the note in its public log`, log.includes("Closed automatically after 7 days with no reply from the customer."));
  }

  const reopen = await raw.callRaw("core/apply_stimulus", {
    class: "UserRequest",
    key: request,
    stimulus: "ev_reopen",
    fields: {},
    output_fields: "id",
    comment: "e2e-auto-close",
  });
  check("closed is final: ev_reopen is refused", reopen.code !== 0);
}

// Outside any request, as the BFF's own account (ITOP_USER).
await runAsServiceAccount(async () => {
try {
  await main();
} catch (error) {
  failures.push("run");
  console.log(`  FAIL  run -- ${error instanceof Error ? error.message : String(error)}`);
} finally {
  for (const [cls, id] of created.reverse()) {
    await raw.callRaw("core/delete", { class: cls, key: id, simulate: false, comment: "e2e-auto-close cleanup" }).catch(() => undefined);
  }
}
});
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join("; ")}` : ""}`);
process.exit(failures.length ? 1 : 0);
