#!/usr/bin/env node
/**
 * Times the BFF's screens against an iTop filled by perf-seed.mjs and prints
 * a Markdown table (median and worst of --runs), for docs/performance.md.
 *
 *   PERF_LOGIN=perf.admin PERF_PORTAL_LOGIN=perf.user001 PERF_PASSWORD=... \
 *   node scripts/perf-measure.mjs [http://127.0.0.1:4800] [--runs 5] [--only name,name]
 *
 * Read-only apart from the session: the import is simulated, nothing is written.
 */

const BASE = (process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4800').replace(/\/+$/, '');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const RUNS = Number(arg('runs', '5'));
const ONLY = arg('only', '').split(',').filter(Boolean);
const LOGIN = process.env.PERF_LOGIN ?? 'perf.admin';
const PORTAL_LOGIN = process.env.PERF_PORTAL_LOGIN ?? 'perf.user001';
const PASSWORD = process.env.PERF_PASSWORD;
if (!PASSWORD) {
  console.error('Set PERF_PASSWORD (the password perf-seed gave every perf.* account).');
  process.exit(2);
}

async function call(cookie, method, path, body) {
  const start = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const buf = await res.arrayBuffer();
  const ms = performance.now() - start;
  const text = new TextDecoder().decode(buf);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, ms, bytes: buf.byteLength, json, lines: text.split(/\r?\n/).filter(Boolean).length };
}

async function signIn(login) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`sign-in as ${login}: HTTP ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (ms) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

async function main() {
  const staff = await signIn(LOGIN);
  const portal = await signIn(PORTAL_LOGIN);

  // Facts the cases need: the last page, a ticket with history, a CSV to import.
  const first = await call(staff, 'GET', '/api/objects/UserRequest?limit=25&fields=id,ref,title');
  const lastPage = first.json?.pages ?? 1;
  // A request with several case-log entries and history: the newest one.
  const someId = first.json?.items?.[0]?.id;
  const people = await call(staff, 'GET', '/api/objects/Person?limit=500&fields=name,first_name,email,org_id');
  const csvRows = (people.json?.items ?? []).slice(0, 500);
  const csv = ['name,first_name,email,org_id', ...[...csvRows, ...csvRows].slice(0, 1000).map((p, i) => `${p.fields.name},${p.fields.first_name},imp${i}-${p.fields.email},${p.fields.org_id}`)].join('\n');
  // An export of ~10,000 rows: the oldest requests, up to the day that makes 10,000.
  const countUpTo = async (day) => {
    const c = encodeURIComponent(JSON.stringify([{ field: 'start_date', op: 'lte', value: `${day} 23:59:59` }]));
    return (await call(staff, 'GET', `/api/objects/UserRequest?limit=1&fields=id&criteria=${c}`)).json?.total ?? 0;
  };
  let lo = Date.UTC(2025, 9, 1);
  let hi = Date.now();
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if ((await countUpTo(new Date(mid).toISOString().slice(0, 10))) < 10_000) lo = mid;
    else hi = mid;
  }
  const exportDay = new Date(hi).toISOString().slice(0, 10);
  const exportRows = await countUpTo(exportDay);
  const exportFields = 'ref,title,status,priority,start_date,caller_id_friendlyname,team_id_friendlyname';
  const exportCriteria = encodeURIComponent(JSON.stringify([{ field: 'start_date', op: 'lte', value: `${exportDay} 23:59:59` }]));
  const criteria = encodeURIComponent(JSON.stringify([
    { field: 'status', op: 'in', values: ['assigned', 'pending'] },
    { field: 'start_date', op: 'gte', value: '2026-07-01' },
  ]));

  const cases = [
    ['sign-in', null, 'POST', '/api/auth/login', { login: LOGIN, password: PASSWORD }],
    ['auth/me', staff, 'GET', '/api/auth/me'],
    // The overview includes My Assignments (the agent's four queues).
    ['dashboard overview (7d)', staff, 'GET', '/api/dashboard/overview?range=7d'],
    ['dashboard overview (90d)', staff, 'GET', '/api/dashboard/overview?range=90d'],
    ['nav counts', staff, 'GET', '/api/nav/counts'],
    ['navigation menu', staff, 'GET', '/api/meta/navigation'],
    ['list UserRequest, page 1', staff, 'GET', '/api/objects/UserRequest?limit=25'],
    [`list UserRequest, last page (${lastPage})`, staff, 'GET', `/api/objects/UserRequest?limit=25&page=${lastPage}`],
    ['list UserRequest, sorted by start_date desc', staff, 'GET', '/api/objects/UserRequest?limit=25&sort=start_date&order=desc'],
    ['list Incident, view Open incidents', staff, 'GET', '/api/objects/Incident?limit=25&view=Incident:OpenIncidents'],
    ['list Incident, filtered status=assigned', staff, 'GET', '/api/objects/Incident?limit=25&status=assigned'],
    ['list Incident, search "VPN"', staff, 'GET', '/api/objects/Incident?limit=25&q=VPN'],
    ['list Incident, advanced search', staff, 'GET', `/api/objects/Incident?limit=25&criteria=${criteria}`],
    ['list FunctionalCI page 1', staff, 'GET', '/api/objects/FunctionalCI?limit=25'],
    ['list Person page 1', staff, 'GET', '/api/objects/Person?limit=25'],
    ['record detail UserRequest', staff, 'GET', `/api/objects/UserRequest/${someId}`],
    ['record History', staff, 'GET', `/api/objects/UserRequest/${someId}/history`],
    ['picker: caller_id options', staff, 'GET', '/api/meta/classes/UserRequest/fields/caller_id/options?q=Sh'],
    [`export ${exportRows} user requests (csv)`, staff, 'GET', `/api/objects/UserRequest/export?format=csv&fields=${exportFields}&criteria=${exportCriteria}`],
    [`export ${exportRows} user requests (xlsx)`, staff, 'GET', `/api/objects/UserRequest/export?format=xlsx&fields=${exportFields}&criteria=${exportCriteria}`],
    ['import 1,000 Person rows (simulate)', staff, 'POST', '/api/objects/Person/import', { csv, simulate: true, reconciliationKeys: ['email'] }],
    ['notification rules', staff, 'GET', '/api/admin/notifications/rules'],
    ['notifications sent', staff, 'GET', '/api/admin/notifications/sent'],
    ['audit overview', staff, 'GET', '/api/admin/audit'],
    // Categories made for this check: every UserRequest (2 rules), every CI (1 rule).
    ['audit run: all user requests', staff, 'POST', '/api/admin/audit/categories/1/run'],
    ['audit run: all CIs', staff, 'POST', '/api/admin/audit/categories/2/run'],
    ['bell: unread count', staff, 'GET', '/api/me/notifications/count'],
    ['bell: list', staff, 'GET', '/api/me/notifications'],
    ['portal: my open requests', portal, 'GET', '/api/portal/requests?state=open&page=1&limit=20'],
    ['portal: my closed requests', portal, 'GET', '/api/portal/requests?state=closed&page=1&limit=20'],
    ['portal: catalog', portal, 'GET', '/api/portal/catalog'],
  ].filter(([name]) => ONLY.length === 0 || ONLY.some((o) => name.includes(o)));

  console.log(`BFF ${BASE}, ${RUNS} runs each, as ${LOGIN} / ${PORTAL_LOGIN}\n`);
  console.log('| Screen / call | Median | Worst | Result |');
  console.log('| --- | ---: | ---: | --- |');
  for (const [name, cookie, method, path, body] of cases) {
    const times = [];
    let last;
    for (let r = 0; r < RUNS; r++) {
      last = await call(cookie, method, path, body);
      times.push(last.ms);
    }
    console.log(`| ${name} | ${fmt(median(times))} | ${fmt(Math.max(...times))} | ${describe(last)} |`);
  }
}

function describe(res) {
  if (res.status !== 200) return `HTTP ${res.status}: ${String(res.json?.error?.message ?? res.json?.message ?? '').slice(0, 120)}`;
  const j = res.json;
  if (!j) return `${(res.bytes / 1024).toFixed(0)} KB file${res.bytes < 2_000_000 && res.lines > 1 ? `, ${res.lines - 1} lines` : ''}`;
  if (typeof j.failing === 'number') return `${j.failing} of ${j.total} failing`;
  if (typeof j.total === 'number') return `${j.items?.length ?? 0} of ${j.total}`;
  if (j.kpis) return `incidents in range ${j.kpis.totalIncidents}, trend sum ${j.trend.reduce((s, d) => s + d.created, 0)}`;
  if (j.incidents && j.requests) return `inc ${j.incidents.total}, req ${j.requests.total}, prob ${j.problems.total}, chg ${j.changes.total}`;
  if (typeof j.unread === 'number') return `${j.items?.length ?? ''} items, ${j.unread} unread`;
  if (j.summary) return JSON.stringify(j.summary).slice(0, 120);
  return `${(res.bytes / 1024).toFixed(0)} KB`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
