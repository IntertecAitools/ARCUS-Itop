/**
 * Data import and sync sources end to end, against a running BFF and the
 * local iTop.
 *
 * Signs in as an administrator and, with throwaway records named after this
 * run:
 *   - reads a CSV and an .xlsx upload;
 *   - imports an organisation, then servers into it (by organisation name),
 *     previewing first: creates, then a second file that updates one server,
 *     leaves one unchanged and fails one row (an unknown organisation);
 *   - imports people keyed on email, one naming the other as manager by full
 *     name, and re-imports them unchanged;
 *   - keeps every run's report, downloadable as CSV;
 *   - defines a Data Synchro source for servers, simulates a run (nothing
 *     kept), runs it, then runs it with one row gone and checks the delete
 *     policy marked that server obsolete; reads the runs' SynchroLogs;
 *   - with E2E_TENANT_BFF (a second BFF with TENANCY=on), checks a tenant's
 *     admin cannot reach another tenant's organisation or the sync sources.
 * Everything it creates in iTop is deleted at the end, pass or fail.
 *
 *   npm run e2e:data-import                                BFF on http://127.0.0.1:4060
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:data-import
 *
 * The account: { "dataImport": { "login", "password", "totpSecret"? } } in
 * backend/e2e.local.json (git-ignored), else its "sla" account. It must be
 * an administrator.
 */
import fs from "node:fs";
import http from "node:http";
import { deflateRawSync } from "node:zlib";

import { timeStep, totpAt } from "../src/platform/auth/totp.ts";

const CONFIG = new URL("../e2e.local.json", import.meta.url);
const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4060");
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5233";
const STAMP = new Date().toISOString().slice(0, 19).replace(/\D/g, "");
const TAG = `zz-di-${STAMP}`;

if (!fs.existsSync(CONFIG)) {
  console.error(`No ${CONFIG.pathname}: add { "dataImport": { "login", "password" } } (see the comment at the top).`);
  process.exit(2);
}
const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const accountKey = config.dataImport ? "dataImport" : "sla";
const account = config[accountKey];
if (!account?.login || !account?.password) {
  console.error('e2e.local.json has no "dataImport" (or "sla") account.');
  process.exit(2);
}

let cookie = "";
let passed = 0;
const failures = [];
/** [class, id], deleted in reverse order at the end. */
const created = [];
const sourcesMade = [];

function send(method, path, body, base = BFF, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        method,
        hostname: base.hostname,
        port: base.port,
        path,
        headers: {
          origin: ORIGIN,
          ...headers,
          ...(headers.cookie === undefined && cookie ? { cookie } : {}),
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
const request = (method, path, body) => send(method, path, body);

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function keepCookie(res) {
  const set = res.headers["set-cookie"];
  if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
}

const code = (secret, offset = 0) => totpAt(secret, timeStep(Date.now()) + offset);

async function signIn() {
  const login = await request("POST", "/api/auth/login", { login: account.login, password: account.password });
  if (login.status !== 200) throw new Error(`sign-in: ${login.status} ${login.text.slice(0, 200)}`);
  keepCookie(login);
  if (login.json.user) return login.json.user;
  if (login.json.mfa?.step === "enrol") {
    const enrol = await request("GET", "/api/auth/mfa/enrol");
    account.totpSecret = enrol.json.secret;
    const done = await request("POST", "/api/auth/mfa/enrol", { code: code(account.totpSecret) });
    keepCookie(done);
    fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
    return done.json.user;
  }
  for (const offset of [0, 1]) {
    if (offset) await new Promise((r) => setTimeout(r, (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000));
    const verify = await request("POST", "/api/auth/mfa/verify", { code: code(account.totpSecret) });
    if (verify.status === 200) {
      keepCookie(verify);
      return verify.json.user;
    }
  }
  throw new Error("MFA code refused");
}

const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

/** A minimal .xlsx: one sheet of inline strings. */
function xlsx(rows) {
  const col = (i) => String.fromCharCode(65 + i);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const sheet =
    "<worksheet><sheetData>" +
    rows
      .map(
        (cells, r) =>
          `<row r="${r + 1}">` +
          cells.map((c, i) => `<c r="${col(i)}${r + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join("") +
          "</row>",
      )
      .join("") +
    "</sheetData></worksheet>";
  const entries = {
    "xl/workbook.xml": '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet,
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(3, 8);
  end.writeUInt16LE(3, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

async function read(fileName, content) {
  const res = await request("POST", "/api/admin/data-import/read", { fileName, content });
  if (res.status !== 200) throw new Error(`read ${fileName}: ${res.status} ${res.text.slice(0, 300)}`);
  return res.json;
}

async function preview(className, body) {
  const res = await request("POST", `/api/admin/data-import/${className}/preview`, body);
  if (res.status !== 200) throw new Error(`preview ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  return res.json;
}

async function run(className, body) {
  const res = await request("POST", `/api/admin/data-import/${className}/run`, body);
  if (res.status !== 201) throw new Error(`run ${className}: ${res.status} ${res.text.slice(0, 300)}`);
  for (const row of res.json.rows) if (row.outcome === "created" && row.id) created.push([className, row.id]);
  return res.json;
}

async function fields(className, id, list) {
  const res = await request("GET", `/api/objects/${className}/${id}?fields=${list}`);
  if (res.status !== 200) throw new Error(`read ${className} ${id}: ${res.status}`);
  return res.json.object?.fields ?? res.json.fields ?? {};
}

async function findByName(className, name) {
  const res = await request("GET", `/api/objects/${className}?name=${encodeURIComponent(name)}&fields=name,status`);
  return (res.json?.items ?? res.json?.objects ?? []).filter((o) => (o.fields?.name ?? o.name) === name);
}

const summary = (s) => JSON.stringify(s);

async function main() {
  console.log(`Data import e2e against ${BFF.origin}, records named ${TAG}*`);
  await signIn();
  check(`signed in as ${account.login}`, Boolean(cookie));

  const classes = await request("GET", "/api/admin/data-import/classes");
  const names = (classes.json?.classes ?? []).map((c) => c.name);
  check(
    "lists the classes it loads",
    ["Person", "Organization", "Team", "Server", "PC", "NetworkDevice", "Location"].every((n) => names.includes(n)),
    names.join(","),
  );

  // --- An organisation, from CSV --------------------------------------------
  const orgName = `${TAG} org`;
  const orgCsv = await read("orgs.csv", b64(`Name;Code\n${orgName};${STAMP}\n`));
  check("reads a semicolon CSV", orgCsv.headings.join("|") === "Name|Code" && orgCsv.rows.length === 1);
  const orgBody = { fileName: "orgs.csv", columns: ["name", "code"], rows: orgCsv.rows, keys: ["name"] };
  const orgPlan = await preview("Organization", orgBody);
  check("previews the organisation as a create", orgPlan.summary.create === 1, summary(orgPlan.summary));
  const orgReport = await run("Organization", orgBody);
  const orgId = orgReport.rows[0]?.id;
  check("creates the organisation", orgReport.summary.created === 1 && orgId > 0, summary(orgReport.summary));

  // --- Servers, from .xlsx, matched on name + organisation -----------------
  const serverRows = [
    ["Server name", "Organization", "Serial number", "Status"],
    [`${TAG} srv-1`, orgName, "SN-1", "production"],
    [`${TAG} srv-2`, orgName, "SN-2", "production"],
  ];
  const book = await read("servers.xlsx", xlsx(serverRows).toString("base64"));
  check("reads an .xlsx", book.sheet === "Data" && book.rows.length === 2, JSON.stringify(book).slice(0, 200));
  const serverColumns = ["name", "org_id->name", "serialnumber", "status"];
  const serverBody = { fileName: "servers.xlsx", columns: serverColumns, rows: book.rows, keys: ["name", "org_id->name"] };
  const serverPlan = await preview("Server", serverBody);
  check("previews two server creates", serverPlan.summary.create === 2, summary(serverPlan.summary));
  const serverReport = await run("Server", serverBody);
  check("creates both servers", serverReport.summary.created === 2, summary(serverReport.summary));
  const srv1 = serverReport.rows[0]?.id;

  const second = {
    fileName: "servers-2.csv",
    columns: serverColumns,
    keys: ["name", "org_id->name"],
    rows: [
      [`${TAG} srv-1`, orgName.toUpperCase(), "SN-1b", "production"],
      [`${TAG} srv-2`, orgName, "SN-2", "production"],
      [`${TAG} srv-3`, `${TAG} no such org`, "SN-3", "production"],
    ],
  };
  const plan2 = await preview("Server", second);
  check(
    "second file: one update, one unchanged, one error",
    plan2.summary.update === 1 && plan2.summary.unchanged === 1 && plan2.summary.error === 1,
    summary(plan2.summary),
  );
  const change = plan2.rows[0]?.changes?.[0];
  check("the update shows the change", change?.field === "serialnumber" && change.from === "SN-1" && change.to === "SN-1b", JSON.stringify(change));
  check("the error names the organisation", /No Organization has name/.test(plan2.rows[2]?.errors?.[0] ?? ""), plan2.rows[2]?.errors?.[0]);
  const report2 = await run("Server", second);
  check("runs it: 1 updated, 1 unchanged, 1 failed", report2.summary.updated === 1 && report2.summary.unchanged === 1 && report2.summary.error === 1, summary(report2.summary));
  check("the update reached iTop", (await fields("Server", srv1, "serialnumber")).serialnumber === "SN-1b");

  // --- People, keyed on email; a manager given by full name ----------------
  const people = {
    fileName: "people.csv",
    columns: ["first_name", "name", "email", "org_id->name", "manager_id->friendlyname"],
    keys: ["email"],
    rows: [[`Ann${STAMP}`, "Boss", `ann.${STAMP}@example.test`, orgName, ""]],
  };
  const peopleReport = await run("Person", people);
  check("creates a person keyed on email", peopleReport.summary.created === 1, summary(peopleReport.summary));
  const withManager = {
    ...people,
    rows: [
      [`Ann${STAMP}`, "Boss", `ANN.${STAMP}@example.test`, orgName, ""],
      [`Bob${STAMP}`, "Report", `bob.${STAMP}@example.test`, orgName, `Ann${STAMP} Boss`],
    ],
  };
  const peoplePlan = await preview("Person", withManager);
  check(
    "matches the person by email, any case; resolves the manager by full name",
    peoplePlan.rows[0]?.action === "unchanged" && peoplePlan.rows[1]?.action === "create",
    JSON.stringify(peoplePlan.rows.map((r) => [r.action, r.errors])),
  );
  const peopleReport2 = await run("Person", withManager);
  const bob = peopleReport2.rows[1]?.id;
  check("creates the report with its manager", peopleReport2.summary.created === 1 && bob > 0, summary(peopleReport2.summary));
  const bobFields = bob ? await fields("Person", bob, "manager_id") : {};
  check("the manager link reached iTop", String(bobFields.manager_id) === String(peopleReport.rows[0]?.id), JSON.stringify(bobFields));

  // --- Reports ---------------------------------------------------------------
  const reports = await request("GET", "/api/admin/data-import/reports");
  check("keeps the run reports", (reports.json?.reports ?? []).some((r) => r.id === report2.id));
  const csv = await request("GET", `/api/admin/data-import/reports/${report2.id}/download`);
  check(
    "downloads a report as CSV",
    csv.status === 200 && /text\/csv/.test(String(csv.headers["content-type"])) && /serialnumber: SN-1 -> SN-1b/.test(csv.text),
    csv.text.slice(0, 200),
  );

  // --- A sync source ------------------------------------------------------------
  const sourceInput = {
    name: `${TAG} discovery`,
    description: "e2e",
    targetClass: "Server",
    keys: ["name"],
    columns: ["name", "org_id", "serialnumber"],
    lookups: { org_id: "name" },
    deletePolicy: "update",
    deletePolicyUpdate: "status:obsolete",
  };
  const made = await request("POST", "/api/admin/data-import/sync-sources", sourceInput);
  check("defines a sync source", made.status === 201, made.text.slice(0, 300));
  if (made.status !== 201) return;
  const source = made.json;
  sourcesMade.push(source.id);
  const att = (code) => source.attributes.find((a) => a.attcode === code);
  check(
    "its attributes follow the input",
    att("name")?.reconcile && att("name")?.update && att("org_id")?.lookup === "name" && !att("org_id")?.reconcile && att("status")?.update === false,
    JSON.stringify(source.attributes.filter((a) => a.update || a.reconcile)),
  );

  const feed = [
    ["ext-1", `${TAG} sync-a`, orgName, "SA-1"],
    ["ext-2", `${TAG} sync-b`, orgName, "SB-1"],
  ];
  const feedColumns = ["primary_key", "name", "org_id", "serialnumber"];
  const sim = await request("POST", `/api/admin/data-import/sync-sources/${source.id}/run`, { columns: feedColumns, rows: feed, simulate: true });
  check("simulates a run", sim.status === 200 && sim.json?.simulated === true, sim.text.slice(0, 300));
  check("the simulation would create both", sim.json?.counts?.["Objects created"] === 2, JSON.stringify(sim.json?.counts));
  check("the simulation kept nothing", (await findByName("Server", `${TAG} sync-a`)).length === 0);

  const real = await request("POST", `/api/admin/data-import/sync-sources/${source.id}/run`, { columns: feedColumns, rows: feed, simulate: false });
  check("runs the sync", real.status === 200 && real.json?.counts?.["Objects created"] === 2, real.text.slice(0, 400));
  check("the run's SynchroLog is returned", real.json?.log?.created === 2, JSON.stringify(real.json?.log));
  const syncA = await findByName("Server", `${TAG} sync-a`);
  const syncB = await findByName("Server", `${TAG} sync-b`);
  for (const o of [...syncA, ...syncB]) created.push(["Server", o.id]);
  check("the synced servers exist", syncA.length === 1 && syncB.length === 1);

  const again = await request("POST", `/api/admin/data-import/sync-sources/${source.id}/run`, {
    columns: feedColumns,
    rows: [feed[0]],
    simulate: false,
  });
  check("a second run with one row gone", again.status === 200, again.text.slice(0, 300));
  const bStatus = syncB[0] ? (await fields("Server", syncB[0].id, "status")).status : "";
  check("the delete policy marked the vanished server obsolete", bStatus === "obsolete", `status=${bStatus}`);

  const detail = await request("GET", `/api/admin/data-import/sync-sources/${source.id}`);
  check("the source lists its runs", detail.json?.logs?.length >= 2 && detail.json?.lastRun?.id === detail.json?.logs?.[0]?.id, JSON.stringify(detail.json?.logs?.slice(0, 2)));
  const logId = detail.json?.logs?.[0]?.id;
  const log = await request("GET", `/api/admin/data-import/sync-sources/${source.id}/logs/${logId}`);
  check("reads a run's log", log.status === 200 && log.json?.id === logId && typeof log.json?.traces === "string", log.text.slice(0, 200));
  const list = await request("GET", "/api/admin/data-import/sync-sources");
  check("the list shows the source with its last run", (list.json?.sources ?? []).some((s) => s.id === source.id && s.lastRun));

  const missingKey = await request("POST", `/api/admin/data-import/sync-sources/${source.id}/run`, { columns: ["name"], rows: [["x"]], simulate: true });
  check("a run without primary_key is refused", missingKey.status === 400);

  // --- Tenancy (optional) ------------------------------------------------------
  if (process.env.E2E_TENANT_BFF) await tenancyChecks(orgName);
}

/** On a TENANCY=on BFF: acme's admin cannot point a row at another organisation, or reach the sources. */
async function tenancyChecks(foreignOrg) {
  const base = new URL(process.env.E2E_TENANT_BFF);
  const host = { host: `acme.localhost:${base.port}`, origin: "http://acme.localhost:5183" };
  const login = await send(
    "POST",
    "/api/auth/login",
    { login: "mt.acme.admin", password: process.env.MT_TEST_PASSWORD ?? "Tenancy-Test-2026!" },
    base,
    { ...host, cookie: "" },
  );
  const tenantCookie = String(login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
  check("tenant admin signs in", login.status === 200 && Boolean(tenantCookie), login.text.slice(0, 200));
  const as = { ...host, cookie: tenantCookie };
  const p = await send(
    "POST",
    "/api/admin/data-import/Server/preview",
    { columns: ["name", "org_id->name"], keys: ["name", "org_id->name"], rows: [[`${TAG} t1`, foreignOrg], [`${TAG} t2`, "zz-mt-acme"]] },
    base,
    as,
  );
  check(
    "tenant admin: another organisation is not found, their own is",
    p.status === 200 && p.json.rows[0]?.action === "error" && p.json.rows[1]?.action === "create",
    p.text.slice(0, 300),
  );
  const s = await send("GET", "/api/admin/data-import/sync-sources", undefined, base, as);
  check("tenant admin: sync sources are the platform's", s.status === 403, `${s.status}`);
}

async function cleanup() {
  console.log("\nCleanup");
  for (const id of sourcesMade) {
    const res = await request("DELETE", `/api/admin/data-import/sync-sources/${id}`);
    if (res.status !== 200) console.log(`  could not delete sync source ${id}: ${res.status} ${res.text.slice(0, 160)}`);
  }
  // People first (a manager is referenced), then servers, then the organisation.
  const order = { Person: 0, Server: 1, Organization: 2 };
  const people = created.filter(([c]) => c === "Person").reverse();
  const rest = created.filter(([c]) => c !== "Person").sort((a, b) => order[a[0]] - order[b[0]]);
  for (const [className, id] of [...people, ...rest]) {
    const res = await request("DELETE", `/api/objects/${className}/${id}?comment=${encodeURIComponent(TAG)}`);
    if (res.status !== 200 && res.status !== 204) {
      console.log(`  could not delete ${className} ${id}: ${res.status} ${res.text.slice(0, 160)}`);
    }
  }
  console.log(`  deleted ${sourcesMade.length} sync source(s) and ${created.length} records`);
}

try {
  await main();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.log(`  ABORTED  ${error.message}`);
} finally {
  await cleanup().catch((e) => console.log(`  cleanup failed: ${e.message}`));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
