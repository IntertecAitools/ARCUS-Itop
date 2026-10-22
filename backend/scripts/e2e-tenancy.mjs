/**
 * Cross-tenant leak test against a running BFF and iTop (TENANCY=on).
 *
 * Signs in as each test tenant's agent and administrator (from
 * `npm run tenants -- seed-test`) and proves tenant A cannot list, read,
 * search, update, transition, delete, export, graph, see the history of, or
 * point a new record at tenant B's records -- by guessing ids too -- and that
 * accounts cannot be given another tenant's organisations. Then the same the
 * other way round. Writes aimed at the other tenant must fail; the only
 * write that may succeed is cleaned up.
 *
 *   npm run e2e:tenancy                      BFF on http://127.0.0.1:4010
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:tenancy
 *
 * Host names are sent as the Host header (acme.localhost, globex.localhost,
 * app.localhost for the platform's own address); nothing has to resolve.
 * Passwords: MT_TEST_PASSWORD, else the seed script's local test default.
 * PLATFORM_LOGIN / PLATFORM_PASSWORD optionally add the platform-operator
 * checks.
 */
import http from "node:http";

const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4010");
const PASSWORD = process.env.MT_TEST_PASSWORD ?? "Tenancy-Test-2026!";
const TENANTS = [
  { id: "mt-acme", host: "acme.localhost", prefix: "mt.acme", org: "zz-mt-acme" },
  { id: "mt-globex", host: "globex.localhost", prefix: "mt.globex", org: "zz-mt-globex" },
];
const PLATFORM_HOST = "app.localhost";

let passed = 0;
const failures = [];

function request(method, path, { host, cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        method,
        hostname: BFF.hostname,
        port: BFF.port,
        path,
        headers: {
          host: `${host}:${BFF.port}`,
          origin: `http://${host}:5183`,
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

async function signIn(login, host, password = PASSWORD) {
  const res = await request("POST", "/api/auth/login", { host, body: { login, password } });
  const cookie = String(res.headers["set-cookie"] ?? "").split(";")[0];
  return { res, cookie, host };
}

/** A session's view: GET/POST/PATCH/DELETE on its own host. */
function as(session, host = session.host) {
  return {
    get: (path) => request("GET", path, { host, cookie: session.cookie }),
    post: (path, body) => request("POST", path, { host, cookie: session.cookie, body }),
    patch: (path, body) => request("PATCH", path, { host, cookie: session.cookie, body }),
    del: (path) => request("DELETE", path, { host, cookie: session.cookie }),
  };
}

const ids = (res) => (res.json?.items ?? []).map((i) => i.id);

/** What a tenant owns, read as its own administrator. */
async function inventory(t, admin) {
  const api = as(admin);
  const find = async (cls, filter) => {
    const res = await api.get(`/api/objects/${cls}?limit=500${filter ? `&${filter}` : ""}`);
    if (res.status !== 200) throw new Error(`${t.id}: listing ${cls} answered ${res.status} ${res.text.slice(0, 200)}`);
    return res.json.items;
  };
  const orgs = await find("Organization", `name=${encodeURIComponent(t.org)}`);
  const tickets = await find("UserRequest");
  const servers = await find("Server");
  const people = await find("Person");
  const users = await api.get("/api/admin/users?limit=200");
  return {
    orgId: orgs[0]?.id,
    ticket: tickets.find((r) => /printer jam/.test(String(r.label ?? r.fields?.title ?? ""))) ?? tickets[0],
    tickets: tickets.map((r) => r.id),
    server: servers[0],
    servers: servers.map((r) => r.id),
    person: people[0],
    people: people.map((r) => r.id),
    userIds: (users.json?.items ?? []).map((u) => u.id),
    logins: (users.json?.items ?? []).map((u) => u.login),
  };
}

async function leakChecks(a, b, A, B) {
  const tag = `${a.id} -> ${b.id}`;
  for (const session of [A.agent, A.admin]) {
    const who = `${tag} (${session === A.agent ? "agent" : "admin"})`;
    const api = as(session);

    // List and search.
    for (const [cls, theirs] of [["UserRequest", B.inv.tickets], ["Ticket", B.inv.tickets], ["Server", B.inv.servers], ["FunctionalCI", B.inv.servers], ["Person", B.inv.people], ["Organization", [B.inv.orgId]]]) {
      const res = await api.get(`/api/objects/${cls}?limit=500`);
      check(`${who}: ${cls} list has none of theirs`, res.status === 200 && !ids(res).some((id) => theirs.includes(id)), `status ${res.status}`);
    }
    const search = await api.get(`/api/objects/UserRequest?q=${encodeURIComponent(b.id === "mt-globex" ? "MT Globex" : "MT Acme")}`);
    check(`${who}: free-text search finds none of theirs`, search.status === 200 && !ids(search).some((id) => B.inv.tickets.includes(id)));
    const criteria = encodeURIComponent(JSON.stringify([{ field: "org_id", op: "equals", value: String(B.inv.orgId) }]));
    const byOrg = await api.get(`/api/objects/UserRequest?criteria=${criteria}`);
    check(`${who}: filtering on their organisation finds nothing`, byOrg.status !== 200 || ids(byOrg).length === 0, `status ${byOrg.status}`);
    const lookups = await api.get(`/api/lookups/Organization?limit=200`);
    check(`${who}: organisation picker lacks theirs`, !String(lookups.text).includes(b.org), `status ${lookups.status}`);

    // Read by guessed id.
    const t = B.inv.ticket.id;
    const s = B.inv.server.id;
    for (const path of [
      `/api/objects/UserRequest/${t}`,
      `/api/objects/Ticket/${t}`,
      `/api/objects/Server/${s}`,
      `/api/objects/Organization/${B.inv.orgId}`,
      `/api/objects/Person/${B.inv.person.id}`,
      `/api/objects/UserRequest/${t}/history`,
      `/api/objects/Server/${s}/related`,
    ]) {
      const res = await api.get(path);
      check(`${who}: GET ${path.replace(/\d+/g, "<theirs>")} is not found`, res.status === 404 || res.status === 403, `status ${res.status}: ${res.text.slice(0, 160)}`);
    }

    // Their link rows (people on a ticket): nothing comes back.
    const links = await api.get(`/api/objects/UserRequest/${t}/links/contacts_list`);
    check(`${who}: links of their ticket are empty or not found`, links.status === 404 || (links.status === 200 && ids(links).length === 0), `status ${links.status}`);

    // Writes on their records.
    const patch = await api.patch(`/api/objects/UserRequest/${t}`, { fields: { title: "cross-tenant write" } });
    check(`${who}: update their ticket refused`, patch.status === 404 || patch.status === 403, `status ${patch.status}`);
    const stimulus = await api.post(`/api/objects/UserRequest/${t}/stimulus`, { stimulus: "ev_assign", fields: {} });
    check(`${who}: transition their ticket refused`, [400, 403, 404].includes(stimulus.status) && !/"ok"\s*:\s*true/.test(stimulus.text), `status ${stimulus.status}`);
    const simulate = await api.del(`/api/objects/Server/${s}?simulate=true`);
    check(`${who}: delete (simulated) their server refused`, simulate.status === 404 || simulate.status === 403, `status ${simulate.status}`);
    const bulk = await api.post(`/api/objects/UserRequest/bulk`, { action: "update", ids: [t], fields: { title: "cross-tenant bulk" } });
    const bulkOk = (bulk.json?.results ?? bulk.json?.items ?? []).some((r) => r.ok === true || r.status === "ok");
    check(`${who}: bulk update of their ticket refused`, !bulkOk, `status ${bulk.status}: ${bulk.text.slice(0, 160)}`);

    // Creates pointing at their records.
    const intoTheirs = await api.post(`/api/objects/UserRequest`, { fields: { title: "x-tenant", description: "x", org_id: B.inv.orgId, caller_id: A.inv.person.id } });
    check(`${who}: create in their organisation refused`, intoTheirs.status === 400 || intoTheirs.status === 403, `status ${intoTheirs.status}`);
    const theirCaller = await api.post(`/api/objects/UserRequest`, { fields: { title: "x-tenant", description: "x", org_id: A.inv.orgId, caller_id: B.inv.person.id } });
    check(`${who}: create with their person as caller refused`, theirCaller.status === 400 || theirCaller.status === 403, `status ${theirCaller.status}`);

    // Export.
    const exp = await api.get(`/api/objects/UserRequest/export?format=csv&fields=id,ref,title,org_id`);
    check(`${who}: export answers`, exp.status === 200, `status ${exp.status}: ${exp.text.slice(0, 160)}`);
    check(`${who}: export holds none of theirs`, !exp.text.includes(b.org) && !exp.text.includes(B.inv.ticket.label ?? "\u0000"));

    // Dashboards and counts.
    const overview = await api.get(`/api/dashboard/overview?range=90d`);
    check(`${who}: dashboard answers without their records`, overview.status === 200 && !overview.text.includes(b.org), `status ${overview.status}`);
  }

  // Saved queries: B's are not A's.
  const created = await as(B.admin).post(`/api/queries`, { name: `${b.id} private query`, recordType: "UserRequest", conditions: [] });
  check(`${b.id}: can save a query`, created.status === 201 || created.status === 200, `status ${created.status}: ${created.text.slice(0, 200)}`);
  const qid = created.json?.id;
  if (qid) {
    const list = await as(A.admin).get(`/api/queries`);
    check(`${tag}: their saved query is not listed`, list.status === 200 && !(list.json?.queries ?? []).some((q) => q.id === qid));
    const one = await as(A.admin).get(`/api/queries/${qid}`);
    check(`${tag}: their saved query by id is not found`, one.status === 404, `status ${one.status}`);
    const run = await as(A.admin).get(`/api/queries/${qid}/results`);
    check(`${tag}: their saved query cannot be run`, run.status === 404, `status ${run.status}`);
    const del = await as(A.admin).del(`/api/queries/${qid}`);
    check(`${tag}: their saved query cannot be deleted`, del.status === 404 || del.status === 403, `status ${del.status}`);
    const mine = await as(B.admin).get(`/api/queries/${qid}/results`);
    const rows = mine.json?.items ?? mine.json?.rows ?? [];
    check(`${b.id}: own saved query runs over own records only`, mine.status === 200 && rows.every((r) => !A.inv.tickets.includes(r.id)), `status ${mine.status}`);
    await as(B.admin).del(`/api/queries/${qid}`);
  }

  // Accounts.
  const users = await as(A.admin).get(`/api/admin/users?limit=200`);
  check(`${tag}: user list lacks their accounts`, users.status === 200 && !(users.json?.items ?? []).some((u) => String(u.login).startsWith(b.prefix)));
  for (const uid of B.inv.userIds.slice(0, 2)) {
    const res = await as(A.admin).get(`/api/admin/users/${uid}`);
    check(`${tag}: their account by id is not found`, res.status === 404, `status ${res.status}`);
  }
  const ownAgent = (users.json?.items ?? []).find((u) => u.login === `${a.prefix}.agent`);
  if (ownAgent) {
    const res = await as(A.admin).patch(`/api/admin/users/${ownAgent.id}`, { allowedOrgIds: [A.inv.orgId, B.inv.orgId] });
    check(`${tag}: cannot give an own account their organisation`, res.status === 400 || res.status === 403, `status ${res.status}`);
  }
  const newUser = await as(A.admin).post(`/api/admin/users`, {
    type: "local",
    login: `${a.prefix}.x${Date.now() % 100000}`,
    password: PASSWORD,
    contact: { id: A.inv.person.id },
    profileIds: [],
    allowedOrgIds: [B.inv.orgId],
  });
  check(`${tag}: cannot create an account with their organisation`, newUser.status === 400 || newUser.status === 403, `status ${newUser.status}`);

  // Domains.
  const wrongSite = await signIn(`${a.prefix}.agent`, b.host);
  check(`${tag}: cannot sign in on their site`, wrongSite.res.status === 403 || wrongSite.res.status === 401, `status ${wrongSite.res.status}`);
  const carried = await as(A.agent, b.host).get(`/api/objects/UserRequest`);
  check(`${tag}: own session refused on their site`, carried.status === 403 || carried.status === 401, `status ${carried.status}`);

  // Their record is unchanged.
  const still = await as(B.admin).get(`/api/objects/UserRequest/${B.inv.ticket.id}?fields=title`);
  check(`${b.id}: their ticket still unchanged`, still.status === 200 && !String(still.text).includes("cross-tenant"), `status ${still.status}`);
}

async function main() {
  const health = await request("GET", "/health", { host: PLATFORM_HOST }).catch((e) => ({ status: 0, text: e.message }));
  if (health.status !== 200) {
    console.error(`BFF not reachable at ${BFF.href}: ${health.text}`);
    process.exit(2);
  }

  const S = {};
  for (const t of TENANTS) {
    const agent = await signIn(`${t.prefix}.agent`, t.host);
    const admin = await signIn(`${t.prefix}.admin`, t.host);
    check(`${t.id}: agent signs in on own site`, agent.res.status === 200, `status ${agent.res.status}: ${agent.res.text.slice(0, 200)}`);
    check(`${t.id}: admin signs in on own site`, admin.res.status === 200, `status ${admin.res.status}: ${admin.res.text.slice(0, 200)}`);
    if (agent.res.status !== 200 || admin.res.status !== 200) {
      console.error("Sign-in failed; run `npm run tenants -- seed-test` first.");
      process.exit(1);
    }
    S[t.id] = { agent, admin, inv: await inventory(t, admin) };
    const inv = S[t.id].inv;
    check(`${t.id}: sees its own records`, inv.orgId > 0 && inv.ticket && inv.server && inv.person, JSON.stringify({ org: inv.orgId, t: inv.tickets.length, s: inv.servers.length }));
    const own = await as(agent).get(`/api/objects/UserRequest/${inv.ticket.id}`);
    check(`${t.id}: agent reads its own ticket`, own.status === 200, `status ${own.status}`);
  }

  const [a, b] = TENANTS;
  await leakChecks(a, b, S[a.id], S[b.id]);
  await leakChecks(b, a, S[b.id], S[a.id]);

  const login = process.env.PLATFORM_LOGIN;
  if (login && process.env.PLATFORM_PASSWORD) {
    const op = await signIn(login, PLATFORM_HOST, process.env.PLATFORM_PASSWORD);
    check("platform operator signs in on the platform address", op.res.status === 200, `status ${op.res.status}`);
    const all = await as(op).get(`/api/objects/UserRequest?limit=500`);
    check("platform operator sees both tenants", [S[a.id], S[b.id]].every((x) => ids(all).includes(x.inv.ticket.id)));
    const onA = await as(op, a.host).get(`/api/objects/UserRequest?limit=500`);
    check("platform operator on a tenant's site sees only that tenant", ids(onA).includes(S[a.id].inv.ticket.id) && !ids(onA).includes(S[b.id].inv.ticket.id));
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
