/**
 * Request forms and the requester's target date, end to end against a
 * running BFF and iTop.
 *
 * Sets up its own corner of the catalogue so nothing else is affected: a
 * service with a subcategory, a customer contract for the staff account's
 * organisation, and an SLA whose time-to-resolve target (72 h, priority 4
 * service requests) applies only to that service. Then:
 *
 *   - an administrator defines the service's and the subcategory's forms
 *     (and a broken one is refused);
 *   - an end user (`e2e.requests.portal`, created or reset here, in that
 *     organisation) reads the merged form, is refused without the required
 *     answer, raises the request with answers, and sees them in its
 *     description and the SLA's target date on the request and in the list;
 *   - an agent raises one through the generic records API with answers;
 *
 * and removes everything it created except the portal account (accounts
 * cannot be deleted from the API; the next run reuses it).
 *
 *   E2E_STAFF_PASSWORD=... npm run e2e:requests          BFF on http://127.0.0.1:4040
 *   E2E_BFF=http://127.0.0.1:4000 E2E_STAFF_LOGIN=admin E2E_STAFF_PASSWORD=... npm run e2e:requests
 */
import { randomBytes } from "node:crypto";

const BFF = (process.env.E2E_BFF ?? "http://127.0.0.1:4040").replace(/\/$/, "");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5213";
const STAFF = { login: process.env.E2E_STAFF_LOGIN ?? "admin", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const PORTAL_LOGIN = "e2e.requests.portal";
const STAMP = `${Date.now().toString(36)}`;

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/** One signed-in session: cookie kept, JSON in and out. */
function session() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(`${BFF}/api${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text };
  };
  return {
    call,
    async signIn(login, password) {
      const res = await call("POST", "/auth/login", { login, password });
      if (res.status !== 200) throw new Error(`Sign-in as ${login} answered ${res.status}: ${res.text.slice(0, 200)}`);
    },
    /** A call that must succeed; its JSON. */
    async ok(method, path, body) {
      const res = await call(method, path, body);
      if (res.status >= 300) throw new Error(`${method} ${path} answered ${res.status}: ${res.text.slice(0, 300)}`);
      return res.json;
    },
  };
}

/** HTML as one line of text, list items as "- ", so the checks read like the block. */
const text = (html) =>
  String(html)
    .replace(/<li>/g, " - ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const staff = session();
const created = []; // [class, id], deleted in reverse order

async function make(cls, fields) {
  const { object } = await staff.ok("POST", `/objects/${cls}`, { fields });
  created.push([cls, object.id]);
  return object.id;
}

async function cleanup() {
  for (const [cls, id] of created.reverse()) {
    const res = await staff.call("DELETE", `/objects/${cls}/${id}`);
    if (res.status >= 300) console.log(`  (cleanup) ${cls} ${id}: ${res.status} ${res.text.slice(0, 160)}`);
  }
}

async function main() {
  if (!STAFF.password) throw new Error("Set E2E_STAFF_PASSWORD (the staff account's password).");
  console.log(`BFF ${BFF}, staff ${STAFF.login}`);
  await staff.signIn(STAFF.login, STAFF.password);
  const me = await staff.ok("GET", "/auth/me");
  const orgId = me.orgId ?? me.user?.orgId;
  if (!orgId) throw new Error("The staff account has no organisation.");

  // --- The catalogue corner, with its own SLA --------------------------------
  const serviceId = await make("Service", { name: `zz-e2e-requests ${STAMP}`, org_id: orgId, status: "production" });
  const subcategoryId = await make("ServiceSubcategory", {
    name: "Laptop",
    service_id: serviceId,
    request_type: "service_request",
    status: "production",
  });
  const sltId = await make("SLT", {
    name: `zz-e2e-requests TTR ${STAMP}`,
    priority: "4",
    request_type: "service_request",
    metric: "ttr",
    value: 72,
    unit: "hours",
  });
  const slaId = await make("SLA", { name: `zz-e2e-requests SLA ${STAMP}`, org_id: orgId });
  await make("lnkSLAToSLT", { sla_id: slaId, slt_id: sltId });
  const contractId = await make("CustomerContract", {
    name: `zz-e2e-requests ${STAMP}`,
    org_id: orgId,
    provider_id: orgId,
    status: "production",
  });
  await make("lnkCustomerContractToService", { customercontract_id: contractId, service_id: serviceId, sla_id: slaId });
  console.log(`  set up service ${serviceId}, subcategory ${subcategoryId}, SLA ${slaId}, contract ${contractId}`);

  // --- An administrator defines the forms -----------------------------------
  const serviceForm = [
    { key: "model", label: "Laptop model", type: "choice", required: true, options: ["ThinkPad X1", "ThinkPad T14"] },
    { key: "needed_by", label: "Needed by", type: "date", required: false, help: "Leave empty if there is no deadline." },
  ];
  const saved = await staff.ok("PUT", `/admin/request-forms/service/${serviceId}`, { fields: serviceForm });
  check("admin saves a service's form", saved.fields.length === 2 && saved.targetName.includes("zz-e2e-requests"));
  const sub = await staff.ok("PUT", `/admin/request-forms/subcategory/${subcategoryId}`, {
    fields: [{ key: "dock", label: "Docking station", type: "choice", required: false, options: ["Yes", "No"] }],
  });
  check("a subcategory's form shows the service's questions as inherited", sub.inherited.length === 2 && sub.fields.length === 1);
  const broken = await staff.call("PUT", `/admin/request-forms/service/${serviceId}`, {
    fields: [{ key: "x", label: "X", type: "choice", required: true, options: [] }],
  });
  check("a choice without options is refused", broken.status === 400, `${broken.status}`);
  const missingTarget = await staff.call("PUT", "/admin/request-forms/service/999999", { fields: serviceForm });
  check("a form for a service that does not exist is refused", missingTarget.status === 404, `${missingTarget.status}`);
  const catalogue = await staff.ok("GET", "/admin/request-forms");
  const listed = catalogue.services.find((s) => s.id === serviceId);
  check(
    "the admin catalogue counts each item's questions",
    listed?.fieldCount === 2 && listed.subcategories.find((s) => s.id === subcategoryId)?.fieldCount === 1,
    JSON.stringify(listed),
  );

  // --- The end user ----------------------------------------------------------
  const portalPassword = `E2e-${randomBytes(12).toString("base64url")}-9a`;
  const { items } = await staff.ok("GET", `/admin/users?q=${encodeURIComponent(PORTAL_LOGIN)}`);
  const existing = items.find((u) => u.login === PORTAL_LOGIN);
  if (existing) {
    if (existing.status !== "enabled") await staff.ok("PATCH", `/admin/users/${existing.id}`, { status: "enabled" });
    await staff.ok("POST", `/admin/users/${existing.id}/password`, { password: portalPassword });
  } else {
    const { profiles } = await staff.ok("GET", "/admin/profiles");
    const portalProfile = profiles.find((p) => p.name === "Portal user");
    await staff.ok("POST", "/admin/users", {
      type: "local",
      login: PORTAL_LOGIN,
      password: portalPassword,
      contact: { firstName: "E2E", lastName: "Requests portal", email: `${PORTAL_LOGIN}@example.test`, orgId },
      profileIds: [portalProfile.id],
    });
  }
  const portal = session();
  await portal.signIn(PORTAL_LOGIN, portalPassword);

  const form = await portal.ok("GET", `/portal/request-form?serviceId=${serviceId}&subcategoryId=${subcategoryId}`);
  check(
    "the portal shows the service's questions, then the subcategory's",
    form.fields.map((f) => f.key).join(",") === "model,needed_by,dock",
    JSON.stringify(form.fields.map((f) => f.key)),
  );
  const outside = await portal.call("GET", "/portal/request-form?serviceId=999999");
  check("the portal refuses the form of a service the user cannot pick", outside.status === 404, `${outside.status}`);
  const staffOnly = await portal.call("GET", `/request-forms/resolve?serviceId=${serviceId}`);
  check("an end user cannot use the staff form endpoint", staffOnly.status === 403 || staffOnly.status === 404, `${staffOnly.status}`);

  const base = { title: `Laptop for a new hire ${STAMP}`, description: "Starts on Monday.", serviceId, subcategoryId, urgency: "4" };
  const unanswered = await portal.call("POST", "/portal/requests", { ...base, answers: { needed_by: "2026-13-01" } });
  check(
    "a request without the required answer (and a bad date) is refused, with every problem named",
    unanswered.status === 400 && /Laptop model is required/.test(unanswered.text) && /Needed by must be a date/.test(unanswered.text),
    `${unanswered.status} ${unanswered.text.slice(0, 200)}`,
  );

  const before = Date.now();
  const raised = await portal.ok("POST", "/portal/requests", {
    ...base,
    answers: { model: "ThinkPad T14", needed_by: "2026-11-02", dock: "Yes" },
  });
  created.push(["UserRequest", raised.id]);
  check(
    "the answers are written into the request's description",
    text(raised.description).includes(
      "Starts on Monday. Request details - Laptop model: ThinkPad T14 - Needed by: 2026-11-02 - Docking station: Yes",
    ) && raised.description.includes("<li><strong>Laptop model:</strong> ThinkPad T14</li>"),
    JSON.stringify(raised.description),
  );
  const hours = (new Date(raised.targetDate).getTime() - before) / 3_600_000;
  check(
    "the requester sees the SLA's target date (72 h after raising)",
    Boolean(raised.targetDate) && hours > 71.5 && hours < 72.5 && raised.targetMissed === false,
    `${raised.targetDate} (${hours.toFixed(2)} h)`,
  );
  const list = await portal.ok("GET", `/portal/requests?q=${encodeURIComponent(STAMP)}`);
  const row = list.items.find((t) => t.id === raised.id);
  check("the target date is in the requester's list too", row?.targetDate === raised.targetDate, JSON.stringify(row));
  const plain = await portal.ok("POST", "/portal/requests", { title: `No service ${STAMP}`, description: "Just a question." });
  created.push(["UserRequest", plain.id]);
  check(
    "a request no SLA applies to has no target date",
    plain.targetDate === "" && text(plain.description) === "Just a question.",
    JSON.stringify({ targetDate: plain.targetDate, description: plain.description }),
  );

  // --- An agent raises one through the records API ---------------------------
  const agentFields = {
    title: `Agent laptop ${STAMP}`,
    description: "Raised by the service desk.",
    org_id: orgId,
    caller_id: me.contactId ?? me.user?.contactId,
    service_id: serviceId,
    servicesubcategory_id: subcategoryId,
  };
  const refused = await staff.call("POST", "/objects/UserRequest", { fields: agentFields });
  check("an agent's request without the required answer is refused", refused.status === 400, `${refused.status}`);
  const agent = await staff.ok("POST", "/objects/UserRequest", {
    fields: agentFields,
    formAnswers: { model: "ThinkPad X1" },
    returnFields: "description",
  });
  created.push(["UserRequest", agent.object.id]);
  const agentRead = await staff.ok("GET", `/objects/UserRequest/${agent.object.id}?fields=description`);
  const description = String(agentRead.fields?.description ?? agentRead.object?.fields?.description ?? "");
  check(
    "an agent's answers are written into the description",
    text(description).includes("Raised by the service desk. Request details - Laptop model: ThinkPad X1"),
    JSON.stringify(description),
  );

  // --- Forms are removed with an empty field list ----------------------------
  await staff.ok("PUT", `/admin/request-forms/subcategory/${subcategoryId}`, { fields: [] });
  await staff.ok("PUT", `/admin/request-forms/service/${serviceId}`, { fields: [] });
  const after = await staff.ok("GET", `/request-forms/resolve?serviceId=${serviceId}&subcategoryId=${subcategoryId}`);
  check("emptying a form removes it", after.fields.length === 0);
}

try {
  await main();
} catch (error) {
  failures.push(String(error instanceof Error ? error.message : error));
  console.log(`  FAIL  ${failures.at(-1)}`);
} finally {
  await cleanup().catch((error) => console.log(`  (cleanup failed) ${error}`));
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
