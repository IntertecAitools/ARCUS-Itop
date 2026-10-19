#!/usr/bin/env node
/**
 * Exercises every HTTP endpoint this BFF exposes, against a real iTop.
 *
 * `npm test` covers the units with stubs; this proves the wiring: routing,
 * validation, status codes, and that the whole chain
 * (BFF -> iTop REST -> MySQL) actually answers. It is the check to run after
 * changing a route, the schema, or anything in itop/.
 *
 *   node scripts/api-check.mjs [baseUrl]
 *
 * Writes: creates ONE incident and walks it to closed, so it leaves a single
 * closed ticket behind. Pass --read-only to skip every write.
 */

const BASE = (process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4000').replace(
  /\/+$/,
  '',
);
const READ_ONLY = process.argv.includes('--read-only');

let passed = 0;
let failed = 0;
const failures = [];

const ms = (start) => `${Math.round(performance.now() - start)}ms`;

async function call(method, path, body) {
  const start = performance.now();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, body: json, took: ms(start) };
}

/**
 * @param expect  status code, or a predicate over the parsed body.
 */
async function check(label, method, path, { body, status = 200, expect } = {}) {
  let result;
  try {
    result = await call(method, path, body);
  } catch (error) {
    failed++;
    failures.push(`${label}: request threw — ${error.message}`);
    console.log(`  FAIL  ${method.padEnd(5)} ${path.padEnd(42)} (no response)`);
    return null;
  }

  const statusOk = result.status === status;
  let bodyOk = true;
  let why = '';
  if (statusOk && expect) {
    try {
      const verdict = expect(result.body);
      bodyOk = verdict === true || verdict === undefined;
      if (typeof verdict === 'string') {
        bodyOk = false;
        why = verdict;
      }
    } catch (error) {
      bodyOk = false;
      why = error.message;
    }
  }

  if (statusOk && bodyOk) {
    passed++;
    console.log(`  ok    ${method.padEnd(5)} ${path.padEnd(42)} ${String(result.status).padEnd(4)} ${result.took}`);
  } else {
    failed++;
    const detail = statusOk
      ? `body: ${why}`
      : `expected ${status}, got ${result.status} — ${JSON.stringify(result.body).slice(0, 160)}`;
    failures.push(`${label}: ${detail}`);
    console.log(`  FAIL  ${method.padEnd(5)} ${path.padEnd(42)} ${String(result.status).padEnd(4)} ${detail.slice(0, 80)}`);
  }
  return result.body;
}

const has = (obj, key) =>
  obj && Object.hasOwn(obj, key) ? true : `missing "${key}" in ${JSON.stringify(obj).slice(0, 120)}`;

console.log(`\nAPI check against ${BASE}${READ_ONLY ? '  (read-only)' : ''}\n`);

console.log('Platform');
await check('health', 'GET', '/health', { expect: (b) => b.status === 'ok' || 'status !== ok' });
await check('upstream', 'GET', '/health/upstream', {
  expect: (b) => b.status === 'ok' || `iTop unreachable: ${b.error ?? '?'}`,
});
await check('meta/modules', 'GET', '/api/meta/modules', {
  expect: (b) =>
    Array.isArray(b.modules) && b.modules.some((m) => m.id === 'incidents')
      ? true
      : 'incidents module not registered',
});
await check('meta/classes', 'GET', '/api/meta/classes', {
  expect: (b) =>
    b.classes?.length >= 100 ? true : `only ${b.classes?.length} classes (expected the full model)`,
});
await check('meta/class', 'GET', '/api/meta/classes/Incident', { expect: (b) => has(b, 'fields') });
await check('meta/diagnostics', 'GET', '/api/meta/diagnostics', { expect: (b) => has(b, 'count') });
await check('objects (generic)', 'GET', '/api/objects/Person?limit=1', {
  expect: (b) => has(b, 'items'),
});
// Lookups return { options, total, truncated } -- a picker list, not a page.
await check('lookups', 'GET', '/api/lookups/Organization', {
  expect: (b) => has(b, 'options'),
});
await check('picker options', 'GET', '/api/meta/classes/Incident/fields/org_id/options', {
  expect: (b) => has(b, 'options'),
});
await check('meta/operations', 'GET', '/api/meta/operations', { expect: (b) => b !== null });
await check('object by id', 'GET', '/api/objects/Organization/1', { expect: (b) => has(b, 'fields') });
await check('object related', 'GET', '/api/objects/Organization/1/related', { expect: (b) => b !== null });

console.log('\nDashboard module');
await check('nav counts', 'GET', '/api/nav/counts', { expect: (b) => has(b, 'openIncidents') });
await check('overview', 'GET', '/api/dashboard/overview?range=7d', {
  expect: (b) =>
    b.kpis && Array.isArray(b.trend) && b.trend.length === 7 ? true : 'kpis/trend malformed',
});
await check('overview 30d', 'GET', '/api/dashboard/overview?range=30d', {
  expect: (b) => (b.trend?.length === 30 ? true : `trend had ${b.trend?.length} points`),
});
await check('overview bad range', 'GET', '/api/dashboard/overview?range=nonsense', { status: 400 });

console.log('\nDirectory module');
await check('organizations', 'GET', '/api/organizations?limit=5', { expect: (b) => has(b, 'items') });
await check('people', 'GET', '/api/people?limit=5', { expect: (b) => has(b, 'items') });
await check('teams', 'GET', '/api/teams?limit=5', { expect: (b) => has(b, 'items') });
await check('directory options', 'GET', '/api/directory/options', {
  expect: (b) => (b.organizations?.length ? true : 'no organisations'),
});
await check('people scoped to an org', 'GET', '/api/people?organizationId=1', {
  expect: (b) => has(b, 'items'),
});
await check('400 person without a name', 'POST', '/api/people', {
  status: 400,
  body: { organizationId: '1' },
});
await check('404 unknown team', 'GET', '/api/teams/999999', { status: 404 });

console.log('\nGeneric records (every iTop class, through the BFF)');
for (const cls of ['Organization', 'Person', 'Team', 'Service', 'Contract', 'Server', 'FAQ']) {
  await check(`list ${cls}`, 'GET', `/api/objects/${cls}?limit=2`, {
    expect: (b) => has(b, 'items'),
  });
}
await check('class metadata', 'GET', '/api/meta/classes/Server', {
  expect: (b) => (b.fields && b.writable ? true : 'schema shape missing'),
});
await check('404 unknown class', 'GET', '/api/objects/NotARealClass', { status: 404 });

console.log("\niTop's modules, published by the BFF");
let navigation;
await check('navigation tree', 'GET', '/api/meta/navigation', {
  expect: (b) => {
    navigation = b;
    if (!Array.isArray(b.groups) || b.groups.length === 0) return 'no groups published';
    if (b.counts.entries !== b.groups.reduce((n, g) => n + g.entries.length, 0)) {
      return 'counts disagree with the groups';
    }
    return true;
  },
});
// The boundary, asserted on the wire rather than only in a unit test: the OQL
// behind a view must never reach the frontend.
await check('navigation leaks no OQL', 'GET', '/api/meta/navigation', {
  expect: (b) => (JSON.stringify(b).includes('SELECT') ? 'response contains OQL' : true),
});
// Every ITSM module the user expects to find, confirmed reachable by class.
for (const cls of ['Incident', 'Problem', 'UserRequest', 'Change', 'SLA', 'FAQ', 'KnownError']) {
  await check(`navigation covers ${cls}`, 'GET', '/api/meta/navigation', {
    expect: (b) =>
      b.groups.some((g) => g.entries.some((e) => e.class === cls))
        ? true
        : `no navigation entry lists ${cls}`,
  });
}
// A view resolves to iTop's own filter, addressed only by id.
await check('list through a view', 'GET', '/api/objects/Incident?view=Incident:OpenIncidents', {
  expect: (b) => has(b, 'items'),
});
await check('404 unknown view', 'GET', '/api/objects/Incident?view=NoSuchView', { status: 404 });
await check('rejects a view from another class', 'GET', '/api/objects/Person?view=Incident:OpenIncidents', {
  status: 400,
});
await check('rejects view and oql together', 'GET', '/api/objects/Incident?view=Incident:OpenIncidents&oql=SELECT%20Incident', {
  status: 400,
});

console.log('\nIncidents module — reads');
await check('list', 'GET', '/api/incidents?limit=5', { expect: (b) => has(b, 'items') });
await check('list paged', 'GET', '/api/incidents?limit=2&page=2', {
  expect: (b) => (b.page === 2 ? true : `page was ${b.page}`),
});
await check('filter status', 'GET', '/api/incidents?status=closed', {
  expect: (b) => b.items.every((i) => i.status === 'closed') || 'returned a non-closed incident',
});
await check('filter priority', 'GET', '/api/incidents?priority=low,medium', {
  expect: (b) =>
    b.items.every((i) => ['low', 'medium'].includes(i.priority)) || 'returned an off-filter row',
});
await check('filter unassigned', 'GET', '/api/incidents?assignee=unassigned', {
  expect: (b) => b.items.every((i) => !i.assignee) || 'returned an assigned incident',
});
await check('search', 'GET', '/api/incidents?q=zzz-no-such-ticket', {
  expect: (b) => (b.total === 0 ? true : `expected no matches, got ${b.total}`),
});
await check('sort', 'GET', '/api/incidents?sort=ref&order=desc&limit=3', {
  expect: (b) => has(b, 'items'),
});
await check('options', 'GET', '/api/incidents/options', {
  expect: (b) =>
    b.organizations?.length && b.priorities?.length ? true : 'pickers came back empty',
});

console.log('\nIncidents module — validation & errors');
await check('404 unknown id', 'GET', '/api/incidents/99999999', { status: 404 });
await check('400 non-numeric id', 'GET', '/api/incidents/abc', { status: 400 });
await check('400 iTop status leaks in', 'GET', '/api/incidents?status=assigned', { status: 400 });
await check('400 bad assignee', 'GET', '/api/incidents?assignee=1;DROP', { status: 400 });
await check('400 create without title', 'POST', '/api/incidents', {
  status: 400,
  body: { description: 'd', organizationId: '1' },
});
await check('400 empty patch', 'PATCH', '/api/incidents/1', { status: 400, body: {} });
await check('400 unknown action', 'POST', '/api/incidents/1/transitions', {
  status: 400,
  body: { action: 'ev_resolve' },
});
await check('404 unknown route', 'GET', '/api/no-such-thing', { status: 404 });

if (!READ_ONLY) {
  console.log('\nIncidents module — writes (full lifecycle)');
  const created = await check('create', 'POST', '/api/incidents', {
    status: 201,
    body: {
      title: `API check ${new Date().toISOString()}`,
      description: 'Raised by scripts/api-check.mjs.',
      organizationId: '1',
      urgency: '3',
      impact: '2',
    },
    expect: (b) => (b.status === 'new' ? true : `new incident was "${b.status}"`),
  });

  const id = created?.id;
  if (id) {
    await check('detail', 'GET', `/api/incidents/${id}`, {
      expect: (b) =>
        b.availableActions?.includes('assign') || `actions were ${b.availableActions}`,
    });
    await check('patch', 'PATCH', `/api/incidents/${id}`, {
      body: { title: 'API check (edited)' },
      expect: (b) => (b.summary === 'API check (edited)' ? true : 'title did not persist'),
    });
    await check('illegal transition rejected', 'POST', `/api/incidents/${id}/transitions`, {
      status: 400,
      body: { action: 'close' },
    });
    await check('resolve without solution rejected', 'POST', `/api/incidents/${id}/transitions`, {
      status: 400,
      body: { action: 'resolve' },
    });
    await check('assign', 'POST', `/api/incidents/${id}/transitions`, {
      body: { action: 'assign', agentId: '1' },
      expect: (b) => (b.status === 'open' ? true : `status was "${b.status}"`),
    });
    await check('log entry', 'POST', `/api/incidents/${id}/log`, {
      body: { message: 'Posted by the API check.' },
      expect: (b) => (b.log?.length > 0 ? true : 'log came back empty'),
    });
    await check('resolve', 'POST', `/api/incidents/${id}/transitions`, {
      body: { action: 'resolve', solution: 'Closed by the API check.' },
      expect: (b) => (b.status === 'resolved' ? true : `status was "${b.status}"`),
    });
    await check('close', 'POST', `/api/incidents/${id}/transitions`, {
      body: { action: 'close' },
      expect: (b) =>
        b.status === 'closed' && b.availableActions.length === 0
          ? true
          : `status "${b.status}", actions ${b.availableActions}`,
    });
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
