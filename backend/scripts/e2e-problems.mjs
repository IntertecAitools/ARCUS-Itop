/**
 * Problem management end to end, against a running BFF and iTop.
 *
 * Signs in as a staff account, then:
 *   - with the arcus-problem-rca extension in iTop: records a root-cause
 *     analysis on a fresh problem (text with markup characters and line
 *     breaks must come back exactly), raises a known error from it and reads
 *     the KnownError back from iTop: root cause, workaround, solution, the
 *     link to the problem, its CIs;
 *   - without it: saving and raising are refused with a 409 naming the
 *     extension, and the Problem record still reads;
 *   - creates incidents on a throwaway service, three weeks apart and one of
 *     them linked to the problem, and checks the trend groups them as
 *     recurring, by service, CI and category.
 * Everything it creates is deleted at the end, pass or fail.
 *
 *   E2E_LOGIN=admin E2E_PASSWORD=... npm run e2e:problems     BFF on http://127.0.0.1:4050
 *   E2E_BFF=http://127.0.0.1:4000 npm run e2e:problems
 *
 * Signs in with a password only, so the BFF it uses needs MFA_REQUIRED=off.
 */
import http from "node:http";

const BFF = new URL(process.env.E2E_BFF ?? "http://127.0.0.1:4050");
const LOGIN = process.env.E2E_LOGIN ?? "admin";
const PASSWORD = process.env.E2E_PASSWORD;
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:5173";
const TAG = `e2e-problems ${new Date().toISOString().slice(0, 19)}`;

if (!PASSWORD) {
  console.error("Set E2E_PASSWORD (and E2E_LOGIN if not admin).");
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

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

async function main() {
  const login = await request("POST", "/api/auth/login", { login: LOGIN, password: PASSWORD });
  if (login.status !== 200) throw new Error(`sign-in: ${login.status} ${login.text.slice(0, 200)}`);
  cookie = String(login.headers["set-cookie"]).split(";")[0];
  const orgId = Number(login.json.user.orgId || 1);

  console.log("\nSetup");
  const serviceId = await create("Service", { name: `${TAG} service`, org_id: orgId });
  let categoryId = 0;
  try {
    categoryId = await create("ServiceSubcategory", { name: `${TAG} category`, service_id: serviceId, request_type: "incident" });
  } catch (e) {
    console.log(`  (no category: ${e.message.slice(0, 120)})`);
  }
  const ci = await request("GET", `/api/objects/FunctionalCI?limit=1&fields=name`);
  const ciId = ci.json?.items?.[0]?.id;
  const problemId = await create("Problem", {
    org_id: orgId,
    title: `${TAG} mail queue stalls`,
    description: "<p>Mail stops &amp; queues</p>",
    impact: "3",
    urgency: "3",
    priority: "4",
    service_id: serviceId,
    ...(categoryId ? { servicesubcategory_id: categoryId } : {}),
  });
  if (ciId) {
    const link = await request("POST", `/api/objects/Problem/${problemId}/links/functionalcis_list`, { targetId: ciId });
    check("problem linked to a CI", link.status === 201 || link.status === 200, `${link.status} ${link.text.slice(0, 200)}`);
  }
  console.log(`  problem ${problemId}, service ${serviceId}, category ${categoryId || "none"}, CI ${ciId ?? "none"}`);

  console.log("\nRoot-cause analysis");
  let res = await request("GET", `/api/problems/${problemId}/analysis`);
  check("analysis answers for a new problem, empty", res.status === 200 && res.json.rootCause === "", res.text.slice(0, 200));
  const withExtension = res.json?.available === true;
  console.log(`  (this iTop ${withExtension ? "has" : "does NOT have"} the arcus-problem-rca extension)`);

  res = await request("POST", `/api/problems/${problemId}/known-errors`, {});
  check(
    `known error refused before any analysis (${withExtension ? 400 : 409})`,
    res.status === (withExtension ? 400 : 409),
    `${res.status}`,
  );

  const first = {
    rootCause: 'Relay cert expired: "mail-01" <smtp> & queue\nsecond line',
    workaround: "Restart the relay",
    resolution: "",
  };
  const second = { ...first, resolution: "Automated certificate renewal" };
  let keId;

  if (!withExtension) {
    res = await request("PUT", `/api/problems/${problemId}/analysis`, first);
    check("saving is refused with the extension named (409)", res.status === 409 && /arcus-problem-rca/.test(res.text), `${res.status} ${res.text.slice(0, 200)}`);
    const record = await request("GET", `/api/objects/Problem/${problemId}`);
    check("the generic Problem screen still reads the record", record.status === 200, `${record.status}`);
  } else {
    res = await request("PUT", `/api/problems/${problemId}/analysis`, first);
    check("analysis saved", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
    res = await request("GET", `/api/problems/${problemId}/analysis`);
    check("markup characters and line breaks come back exactly", res.json?.rootCause === first.rootCause, JSON.stringify(res.json?.rootCause));
    check("workaround stored", res.json?.workaround === first.workaround);

    res = await request("PUT", `/api/problems/${problemId}/analysis`, second);
    res = await request("GET", `/api/problems/${problemId}/analysis`);
    check("resolution stored (Problem.solution)", res.json?.resolution === second.resolution && res.json?.rootCause === first.rootCause);
    const record = await request("GET", `/api/objects/Problem/${problemId}`);
    check("the generic Problem screen still reads the record", record.status === 200, `${record.status}`);

    console.log("\nKnown error");
    res = await request("POST", `/api/problems/${problemId}/known-errors`, { domain: "Server", errorCode: "E-RELAY" });
    check("known error created (201)", res.status === 201, `${res.status} ${res.text.slice(0, 300)}`);
    keId = res.json?.id;
    if (keId) created.push(["KnownError", Number(keId)]);
    check("CIs copied", !ciId || res.json?.linkedCis === 1, `${res.json?.linkedCis}`);

    const ke = await request("GET", `/api/objects/KnownError/${keId}?fields=name,problem_id,root_cause,workaround,solution,symptom,domain,error_code`);
    const f = ke.json?.fields ?? {};
    check("root cause copied", f.root_cause === second.rootCause, JSON.stringify(f.root_cause));
    check("workaround copied", f.workaround === second.workaround);
    check("resolution copied as the solution", f.solution === second.resolution);
    check("linked back to the problem", String(f.problem_id) === String(problemId), `${f.problem_id}`);
    check("symptom from the problem's description", f.symptom === "Mail stops & queues", JSON.stringify(f.symptom));
    check("domain and error code as given", f.domain === "Server" && f.error_code === "E-RELAY");
    if (ciId) {
      const cis = await request("GET", `/api/objects/KnownError/${keId}/links/ci_list?fields=functionalci_id,reason`);
      const rows = cis.json?.items ?? [];
      check(
        "known error links exactly the problem's CI",
        rows.length === 1 && String(rows[0].fields.functionalci_id) === String(ciId),
        `${cis.status} ${cis.text.slice(0, 400)}`,
      );
    }

    res = await request("GET", `/api/problems/${problemId}/analysis`);
    check("the problem lists its known error", (res.json?.knownErrors ?? []).some((k) => k.id === String(keId)));
  }

  console.log("\nTrend");
  for (const [n, linked] of [[1, true], [8, false], [15, false]]) {
    const id = await create("Incident", {
      org_id: orgId,
      title: `${TAG} incident ${n}d ago`,
      description: "relay down",
      impact: "3",
      urgency: "3",
      priority: "4",
      service_id: serviceId,
      ...(categoryId ? { servicesubcategory_id: categoryId } : {}),
      start_date: daysAgo(n),
      ...(linked ? { parent_problem_id: problemId } : {}),
    });
    if (ciId) await request("POST", `/api/objects/Incident/${id}/links/functionalcis_list`, { targetId: ciId });
  }

  res = await request("GET", `/api/problems/trends?period=30d&groupBy=service`);
  check("trend answers (service)", res.status === 200, `${res.status} ${res.text.slice(0, 200)}`);
  const group = res.json?.groups?.find((g) => g.key === String(serviceId));
  check("our service is a group with 3 incidents", group?.incidents === 3, JSON.stringify(group));
  check("one linked, two without a problem", group?.linkedIncidents === 1 && group?.unlinkedIncidents === 2);
  check("flagged recurring (3 weeks)", group?.recurring === true && group?.activeBuckets >= 2);
  check("the problem is listed for the group", (group?.problemRefs ?? []).some((p) => p.id === String(problemId)));
  check("the problem counts as opened in the period", group?.problems === 1 && group?.openProblems === 1);
  check("weekly buckets over 30 days", res.json?.bucket === "week" && res.json?.buckets.length >= 5);

  if (categoryId) {
    res = await request("GET", `/api/problems/trends?period=90d&groupBy=category`);
    const cat = res.json?.groups?.find((g) => g.key === String(categoryId));
    check("grouped by category", cat?.incidents === 3, JSON.stringify(cat));
  }
  if (ciId) {
    res = await request("GET", `/api/problems/trends?period=365d&groupBy=ci`);
    const byCi = res.json?.groups?.find((g) => g.key === String(ciId));
    check("grouped by CI, monthly over a year", res.json?.bucket === "month" && byCi?.incidents >= 3, JSON.stringify(byCi)?.slice(0, 200));
  }

  res = await request("GET", `/api/problems/trends?period=7d`);
  check("an unknown period is a 400", res.status === 400);
}

async function cleanup() {
  console.log("\nCleanup");
  for (const [className, id] of created.reverse()) {
    const res = await request("DELETE", `/api/objects/${className}/${id}?comment=${encodeURIComponent(TAG)}`);
    console.log(`  ${res.status < 300 ? "deleted" : `NOT deleted (${res.status})`} ${className} ${id}`);
  }
}

try {
  await main();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.log(`  FAIL  aborted: ${error.message}`);
} finally {
  if (cookie) await cleanup();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
