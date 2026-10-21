#!/usr/bin/env node
/**
 * Fills an iTop with realistic data volume, through iTop's REST API, for
 * performance checks (docs/performance.md).
 *
 *   PERF_ITOP_URL=http://127.0.0.1:8189 PERF_ITOP_USER=... PERF_ITOP_PASSWORD=... \
 *   PERF_USER_PASSWORD=... node scripts/perf-seed.mjs [--scale 1] [--seed 42] \
 *     [--concurrency 6] [--only orgs,persons,...] [--until 2026-10-21]
 *
 * NEVER point it at an iTop people use: it writes tens of thousands of
 * records. It refuses the shared local iTop (:8080) outright.
 *
 * At --scale 1: 20 organisations, 2,000 people, 100 teams, 300 services and
 * subcategories, 10,000 CIs, 50,000 tickets (incidents, user requests,
 * problems, changes) over the 12 months before --until, each with case-log
 * entries, 500 users, and newsroom notifications (the bell) for perf.admin.
 *
 * Idempotent: every record carries a deterministic key (name, email, login,
 * or "(perf N)" in a ticket title), the script reads which keys exist and
 * creates only the missing ones. Seeded: the same --seed and --until give the
 * same data. Every account gets PERF_USER_PASSWORD; perf.admin is an
 * Administrator, perf.agentNNN are Support Agents, perf.userNNN portal users
 * (perf.user001 is the caller of many requests).
 */

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const URL_ = (process.env.PERF_ITOP_URL ?? '').replace(/\/+$/, '');
const USER = process.env.PERF_ITOP_USER;
const PASSWORD = process.env.PERF_ITOP_PASSWORD;
const USER_PASSWORD = process.env.PERF_USER_PASSWORD;
const SCALE = Number(arg('scale', '1'));
const SEED = Number(arg('seed', '42'));
const CONCURRENCY = Number(arg('concurrency', '6'));
const ONLY = arg('only', '')
  .split(',')
  .filter(Boolean);
const UNTIL = new Date(`${arg('until', new Date().toISOString().slice(0, 10))}T00:00:00Z`);

if (!URL_ || !USER || !PASSWORD || !USER_PASSWORD) {
  console.error('Set PERF_ITOP_URL, PERF_ITOP_USER, PERF_ITOP_PASSWORD and PERF_USER_PASSWORD.');
  process.exit(2);
}
if (/:8080\b/.test(URL_) && !process.argv.includes('--i-know-this-is-not-shared')) {
  console.error(`Refusing ${URL_}: that is the shared local iTop. Use a separate perf iTop.`);
  process.exit(2);
}

const n = (base) => Math.max(1, Math.round(base * SCALE));
const COUNTS = {
  orgs: 20,
  persons: n(2000),
  agents: n(600), // persons 1..agents work for the provider
  teams: n(100),
  services: n(60),
  subsPerService: 4, // 300 services + subcategories at scale 1
  cis: n(10000),
  agentUsers: n(300),
  portalUsers: n(200),
  tickets: n(50000),
  heavyCallerRequests: n(1500),
  newsroom: n(300),
};

// --- seeded randomness --------------------------------------------------------

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A generator per record, so a record's values do not depend on what ran before. */
const rngFor = (kind, i) => mulberry32(SEED * 1_000_003 + kind.length * 7919 + i * 31 + kind.charCodeAt(0));
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const pad = (i, w) => String(i).padStart(w, '0');

// --- iTop REST -----------------------------------------------------------------

let calls = 0;
async function rest(payload, attempt = 0) {
  calls++;
  const body = new URLSearchParams({ auth_user: USER, auth_pwd: PASSWORD, json_data: JSON.stringify(payload) });
  try {
    const res = await fetch(`${URL_}/webservices/rest.php?version=1.4`, { method: 'POST', body });
    const text = await res.text();
    const json = JSON.parse(text);
    if (json.code !== 0) throw new Error(`iTop code ${json.code}: ${json.message}`);
    return json;
  } catch (error) {
    // Lock waits and the odd 5xx under load: retry a few times, then fail loudly.
    if (attempt < 3 && !/code (1|2|3|4|5|100)\b/.test(String(error.message))) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return rest(payload, attempt + 1);
    }
    throw error;
  }
}

const objects = (json) => Object.values(json.objects ?? {});

/** Every row of an OQL query, `fields` only, paged. */
async function getAll(cls, oql, fields, pageSize = 2000) {
  const rows = [];
  for (let page = 1; ; page++) {
    const json = await rest({ operation: 'core/get', class: cls, key: oql, output_fields: fields, limit: pageSize, page });
    const batch = objects(json).map((o) => ({ id: Number(o.key), ...o.fields }));
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

async function create(cls, fields) {
  const json = await rest({ operation: 'core/create', comment: 'perf-seed', class: cls, fields, output_fields: 'id' });
  return Number(objects(json)[0].key);
}

/** Runs `job` over `items` with CONCURRENCY in flight, printing progress. */
async function pool(label, items, job) {
  const started = performance.now();
  let next = 0;
  let done = 0;
  let failed = 0;
  const errors = new Map();
  const tick = () => {
    const s = (performance.now() - started) / 1000;
    process.stdout.write(`\r  ${label}: ${done}/${items.length} (${failed} failed) ${s.toFixed(0)}s, ${(done / s).toFixed(1)}/s   `);
  };
  const timer = setInterval(tick, 2000);
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await job(item);
        } catch (error) {
          failed++;
          const key = String(error.message).slice(0, 160);
          errors.set(key, (errors.get(key) ?? 0) + 1);
        }
        done++;
      }
    }),
  );
  clearInterval(timer);
  tick();
  process.stdout.write('\n');
  for (const [message, count] of errors) console.log(`    ${count}x ${message}`);
  return (performance.now() - started) / 1000;
}

const timings = {};
const want = (step) => ONLY.length === 0 || ONLY.includes(step);

/** Creates what is missing: `specs` are {key, fields}; `existing` maps key -> id. */
async function ensure(step, cls, keyField, specs, oql = `SELECT ${cls}`) {
  const existing = new Map((await getAll(cls, oql, keyField)).map((r) => [String(r[keyField]), r.id]));
  const missing = specs.filter((s) => !existing.has(s.key));
  if (want(step) && missing.length > 0) {
    timings[step] = await pool(`${step} (${cls})`, missing, async (s) => {
      existing.set(s.key, await create(cls, s.fields));
    });
  } else {
    console.log(`  ${step} (${cls}): ${existing.size} present, ${missing.length} missing${want(step) ? '' : ' (skipped)'}`);
  }
  return existing;
}

// --- data ------------------------------------------------------------------------

const FIRST = ['Aarav', 'Maya', 'Liam', 'Noah', 'Emma', 'Olivia', 'Arjun', 'Priya', 'Lucas', 'Sofia', 'Ravi', 'Anika', 'Mateo', 'Chloe', 'Kenji', 'Fatima', 'Omar', 'Elena', 'Ivan', 'Zara', 'Leo', 'Nina', 'Sam', 'Ana', 'Yusuf'];
const LAST = ['Sharma', 'Martin', 'Garcia', 'Nguyen', 'Kumar', 'Smith', 'Dubois', 'Rossi', 'Iyer', 'Kim', 'Silva', 'Novak', 'Haddad', 'Fischer', 'Okafor', 'Tanaka', 'Rao', 'Lopez', 'Moreau', 'Ali'];
const SYMPTOMS = ['cannot log in', 'is very slow', 'shows an error', 'stopped working', 'needs a reset', 'is not reachable', 'keeps crashing', 'lost its connection', 'prints blank pages', 'needs more disk space', 'asks for a licence', 'has no network'];
const THINGS = ['VPN', 'email', 'laptop', 'printer', 'ERP', 'CRM', 'Wi-Fi', 'file share', 'payroll app', 'phone', 'monitor', 'Teams', 'badge reader', 'database', 'website'];
const REQUESTS = ['New laptop for', 'Access to shared folder for', 'Software install for', 'New account for', 'Password reset for', 'Phone for', 'VPN access for', 'Mailbox for'];
const MESSAGES = ['Looking into it.', 'Could you send a screenshot?', 'Restarted the service, please check again.', 'Escalated to the second level.', 'Waiting for the vendor.', 'Works again on my side.', 'Applied the fix from the knowledge base.', 'User confirmed it is solved.', 'Scheduled for tonight.', 'Replaced the device.'];

const DAY = 86_400_000;
const itopDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

async function main() {
  const t0 = performance.now();
  console.log(`perf-seed against ${URL_}, scale ${SCALE}, seed ${SEED}, concurrency ${CONCURRENCY}, until ${UNTIL.toISOString().slice(0, 10)}`);

  // Organisations: index 0 is the IT provider, the rest are customers.
  const orgNames = Array.from({ length: COUNTS.orgs }, (_, i) => (i === 0 ? 'Perf IT Provider' : `Perf Customer ${pad(i, 2)}`));
  const orgs = await ensure('orgs', 'Organization', 'name', orgNames.map((name) => ({ key: name, fields: { name } })));
  const orgId = (i) => orgs.get(orgNames[i]);
  const customerOrg = (i) => 1 + (i % (COUNTS.orgs - 1));

  // People: 1..agents work for the provider, the rest for the customers.
  const personSpecs = Array.from({ length: COUNTS.persons }, (_, k) => {
    const i = k + 1;
    const rnd = rngFor('person', i);
    const org = i <= COUNTS.agents ? 0 : customerOrg(i);
    return {
      key: `p${pad(i, 5)}@perf.test`,
      fields: { name: pick(rnd, LAST), first_name: pick(rnd, FIRST), email: `p${pad(i, 5)}@perf.test`, org_id: orgId(org), function: i <= COUNTS.agents ? 'Support engineer' : 'Employee' },
    };
  });
  const persons = await ensure('persons', 'Person', 'email', personSpecs, "SELECT Person WHERE email LIKE '%@perf.test'");
  const personId = (i) => persons.get(`p${pad(i, 5)}@perf.test`);

  // Teams of six agents each.
  const teamMembers = (t) => Array.from({ length: 6 }, (_, k) => 1 + ((t * 6 + k) % COUNTS.agents));
  const teamName = (t) => `Perf Team ${pad(t + 1, 3)}`;
  const teams = await ensure(
    'teams',
    'Team',
    'name',
    Array.from({ length: COUNTS.teams }, (_, t) => ({
      key: teamName(t),
      fields: { name: teamName(t), org_id: orgId(0), persons_list: teamMembers(t).map((p) => ({ person_id: personId(p) })) },
    })),
  );

  // Service catalogue.
  const families = await ensure(
    'services',
    'ServiceFamily',
    'name',
    ['Workplace', 'Infrastructure', 'Business apps', 'Security', 'Communication', 'Facilities'].map((f) => ({ key: `Perf ${f}`, fields: { name: `Perf ${f}` } })),
    "SELECT ServiceFamily WHERE name LIKE 'Perf %'",
  );
  const familyIds = [...families.values()];
  const serviceName = (s) => `Perf Service ${pad(s + 1, 3)}`;
  const services = await ensure(
    'services',
    'Service',
    'name',
    Array.from({ length: COUNTS.services }, (_, s) => ({
      key: serviceName(s),
      fields: { name: serviceName(s), org_id: orgId(0), servicefamily_id: familyIds[s % familyIds.length], status: 'production' },
    })),
    "SELECT Service WHERE name LIKE 'Perf %'",
  );
  const subName = (s, k) => `Perf Sub ${pad(s + 1, 3)}-${k + 1}`;
  const subs = await ensure(
    'services',
    'ServiceSubcategory',
    'name',
    Array.from({ length: COUNTS.services * COUNTS.subsPerService }, (_, j) => {
      const s = Math.floor(j / COUNTS.subsPerService);
      const k = j % COUNTS.subsPerService;
      return {
        key: subName(s, k),
        fields: { name: subName(s, k), service_id: services.get(serviceName(s)), request_type: k < 2 ? 'incident' : 'service_request', status: 'production' },
      };
    }),
    "SELECT ServiceSubcategory WHERE name LIKE 'Perf %'",
  );

  // One customer contract per customer, covering every service (so any
  // service is allowed on that customer's tickets).
  await ensure(
    'services',
    'CustomerContract',
    'name',
    Array.from({ length: COUNTS.orgs - 1 }, (_, c) => ({
      key: `Perf Contract ${pad(c + 1, 2)}`,
      fields: {
        name: `Perf Contract ${pad(c + 1, 2)}`,
        org_id: orgId(c + 1),
        provider_id: orgId(0),
        services_list: [...services.values()].map((id) => ({ service_id: id })),
      },
    })),
    "SELECT CustomerContract WHERE name LIKE 'Perf %'",
  );

  // CIs, by class.
  const ndTypes = (await getAll('NetworkDeviceType', 'SELECT NetworkDeviceType', 'name')).map((r) => r.id);
  const ciPlan = [
    ['PC', 'perf-pc', 0.4],
    ['Server', 'perf-srv', 0.25],
    ['NetworkDevice', 'perf-net', 0.1],
    ['Printer', 'perf-prn', 0.1],
    ['MobilePhone', 'perf-mob', 0.1],
    ['ApplicationSolution', 'perf-app', 0.05],
  ];
  const ciIds = [];
  for (const [cls, prefix, share] of ciPlan) {
    const count = Math.round(COUNTS.cis * share);
    const map = await ensure(
      'cis',
      cls,
      'name',
      Array.from({ length: count }, (_, k) => {
        const rnd = rngFor(cls, k);
        const fields = {
          name: `${prefix}-${pad(k + 1, 5)}`,
          org_id: orgId(customerOrg(k)),
          status: cls === 'ApplicationSolution' ? pick(rnd, ['active', 'active', 'inactive']) : pick(rnd, ['production', 'production', 'production', 'implementation', 'stock', 'obsolete']),
          business_criticity: pick(rnd, ['low', 'medium', 'medium', 'high']),
        };
        if (cls === 'NetworkDevice' && ndTypes.length) fields.networkdevicetype_id = pick(rnd, ndTypes);
        return { key: fields.name, fields };
      }),
      `SELECT ${cls} WHERE name LIKE '${prefix}-%'`,
    );
    ciIds.push(...map.values());
  }

  // Accounts.
  const profiles = new Map((await getAll('URP_Profiles', 'SELECT URP_Profiles', 'name')).map((r) => [r.name, r.id]));
  const profileList = (...names) => names.map((p) => ({ profileid: profiles.get(p) }));
  const userSpecs = [
    { key: 'perf.admin', fields: { login: 'perf.admin', contactid: personId(1), password: USER_PASSWORD, language: 'EN US', profile_list: profileList('Administrator', 'REST Services User') } },
    ...Array.from({ length: COUNTS.agentUsers }, (_, k) => ({
      key: `perf.agent${pad(k + 1, 3)}`,
      fields: { login: `perf.agent${pad(k + 1, 3)}`, contactid: personId(k + 2), password: USER_PASSWORD, language: 'EN US', profile_list: profileList('Support Agent', 'REST Services User') },
    })),
    ...Array.from({ length: COUNTS.portalUsers }, (_, k) => ({
      key: `perf.user${pad(k + 1, 3)}`,
      fields: { login: `perf.user${pad(k + 1, 3)}`, contactid: personId(COUNTS.agents + 1 + k), password: USER_PASSWORD, language: 'EN US', profile_list: profileList('Portal user') },
    })),
  ];
  await ensure('users', 'UserLocal', 'login', userSpecs, "SELECT UserLocal WHERE login LIKE 'perf.%'");

  // Tickets.
  if (want('tickets')) await seedTickets({ personId, orgId, customerOrg, teams, teamName, teamMembers, services, serviceName, subs, subName, ciIds });

  // The bell: newsroom notifications for perf.admin.
  if (want('newsroom')) await seedNewsroom(personId(1));

  const total = (performance.now() - t0) / 1000;
  console.log(`\ndone in ${(total / 60).toFixed(1)} min, ${calls} REST calls`);
  for (const [step, s] of Object.entries(timings)) console.log(`  ${step}: ${(s / 60).toFixed(1)} min`);
}

async function seedTickets(ctx) {
  const { personId, orgId, customerOrg, teams, teamName, teamMembers, services, serviceName, subs, subName, ciIds } = ctx;
  const T = COUNTS.tickets;
  // Shares of the 50,000.
  const plan = [
    ['UserRequest', 0.4],
    ['Incident', 0.36],
    ['Problem', 0.04],
    ['NormalChange', 0.12],
    ['RoutineChange', 0.06],
    ['EmergencyChange', 0.02],
  ];
  const classOf = [];
  for (const [cls, share] of plan) for (let k = 0; k < Math.round(T * share); k++) classOf.push(cls);
  while (classOf.length < T) classOf.push('Incident');

  const existing = new Set();
  for (const row of await getAll('Ticket', "SELECT Ticket WHERE title LIKE '%(perf %'", 'title', 5000)) {
    const m = /\(perf (\d+)\)/.exec(row.title);
    if (m) existing.add(Number(m[1]));
  }
  const todo = [];
  for (let i = 1; i <= T; i++) if (!existing.has(i)) todo.push(i);
  console.log(`  tickets: ${existing.size} present, ${todo.length} to create`);
  if (todo.length === 0) return;

  const heavyCaller = personId(COUNTS.agents + 1); // perf.user001's person
  const spanMs = 365 * DAY;
  const until = UNTIL.getTime();

  timings.tickets = await pool('tickets', todo, async (i) => {
    const rnd = rngFor('ticket', i);
    const cls = classOf[(i * 7919) % T]; // interleave classes over time
    // Ticket i is filed after ticket i-1, so iTop's refs follow time as they
    // do in real use; slightly more tickets recently, as the use grows.
    const age = Math.pow(Math.max(0, 1 - (i - rnd()) / T), 1.3) * spanMs;
    const start = until - age;
    const daysOld = age / DAY;
    const t = Math.floor(rnd() * COUNTS.teams);
    const agent = pick(rnd, teamMembers(t));
    // A customer employee, filed under that employee's organisation.
    const callerIdx = COUNTS.agents + 1 + Math.floor(rnd() * (COUNTS.persons - COUNTS.agents));
    let caller = personId(callerIdx);
    let org = customerOrg(callerIdx);
    const isHeavy = cls === 'UserRequest' && i % Math.max(1, Math.floor((T * 0.4) / COUNTS.heavyCallerRequests)) === 0;
    if (isHeavy) {
      caller = heavyCaller;
      org = customerOrg(COUNTS.agents + 1);
    }
    // Lifecycle by age: old tickets are closed, recent ones still open.
    const r = rnd();
    let stage;
    if (daysOld > 30) stage = r < 0.9 ? 'closed' : r < 0.97 ? 'resolved' : 'assigned';
    else if (daysOld > 7) stage = r < 0.5 ? 'closed' : r < 0.75 ? 'resolved' : r < 0.9 ? 'assigned' : 'pending';
    else stage = r < 0.15 ? 'resolved' : r < 0.6 ? 'assigned' : r < 0.75 ? 'pending' : 'new';
    const resolvedAt = start + (0.1 + rnd() * 5) * DAY;
    const closedAt = resolvedAt + (0.5 + rnd() * 3) * DAY;
    const lastUpdate = Math.min(until, stage === 'closed' ? closedAt : stage === 'resolved' ? resolvedAt : start + rnd() * Math.min(age, 3 * DAY));

    const s = Math.floor(rnd() * COUNTS.services);
    const thing = pick(rnd, THINGS);
    const fields = {
      org_id: orgId(org),
      caller_id: caller,
      start_date: itopDate(start),
      last_update: itopDate(lastUpdate),
    };
    const entries = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, e) => ({
      date: itopDate(Math.min(until, start + (e + 1) * (0.05 + rnd()) * DAY)),
      user_login: `${pick(rnd, FIRST)} ${pick(rnd, LAST)}`,
      message: pick(rnd, MESSAGES),
    }));
    // Problems and changes have only the private log.
    const hasPublic = cls === 'UserRequest' || cls === 'Incident';
    if (hasPublic) fields.public_log = { items: entries };
    if (!hasPublic || rnd() < 0.3) fields.private_log = { items: hasPublic ? [{ ...entries[0], message: 'Internal note: checked the monitoring.' }] : entries };
    if (stage !== 'new') {
      fields.team_id = teams.get(teamName(t));
      fields.agent_id = personId(agent);
    }

    let status = stage;
    if (cls === 'UserRequest' || cls === 'Incident') {
      const k = cls === 'Incident' ? Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
      fields.title = cls === 'Incident' ? `${thing} ${pick(rnd, SYMPTOMS)} (perf ${i})` : `${pick(rnd, REQUESTS)} ${pick(rnd, FIRST)} (perf ${i})`;
      fields.description = `<p>Reported by the caller. The ${thing} ${pick(rnd, SYMPTOMS)} since this morning.</p>`;
      fields.service_id = services.get(serviceName(s));
      fields.servicesubcategory_id = subs.get(subName(s, k));
      fields.impact = pick(rnd, ['1', '2', '3', '3']);
      fields.urgency = pick(rnd, ['1', '2', '3', '4', '4']);
      fields.origin = pick(rnd, cls === 'Incident' ? ['mail', 'phone', 'portal', 'monitoring'] : ['mail', 'phone', 'portal', 'portal', 'chat']);
      if (cls === 'UserRequest') fields.request_type = 'service_request';
      if (stage === 'resolved' || stage === 'closed') {
        fields.resolution_date = itopDate(resolvedAt);
        fields.resolution_code = pick(rnd, ['assistance', 'bug fixed', 'hardware repair', 'other', 'software patch']);
        fields.solution = 'Fixed as described in the log.';
      }
      if (stage === 'closed') {
        fields.close_date = itopDate(closedAt);
        fields.user_satisfaction = pick(rnd, ['1', '1', '2', '3']);
      }
      if (rnd() < 0.6 && ciIds.length) fields.functionalcis_list = [{ functionalci_id: pick(rnd, ciIds) }];
    } else if (cls === 'Problem') {
      fields.title = `Recurring: ${thing} ${pick(rnd, SYMPTOMS)} (perf ${i})`;
      fields.description = `<p>Root cause analysis for repeated ${thing} incidents.</p>`;
      fields.service_id = services.get(serviceName(s));
      fields.impact = pick(rnd, ['1', '2', '3']);
      fields.urgency = pick(rnd, ['1', '2', '3', '4']);
      if (stage === 'pending') status = 'assigned';
      if (stage === 'resolved' || stage === 'closed') fields.resolution_date = itopDate(resolvedAt);
      if (stage === 'closed') fields.close_date = itopDate(closedAt);
    } else {
      // Changes: new -> ... -> closed, with their own state names.
      fields.title = `Change: upgrade ${thing} (perf ${i})`;
      fields.description = `<p>Planned change on the ${thing}.</p>`;
      fields.start_date = itopDate(start);
      fields.end_date = itopDate(start + (1 + rnd() * 5) * DAY);
      status = { new: 'new', assigned: 'assigned', pending: 'plannedscheduled', resolved: 'implemented', closed: 'closed' }[stage];
      if (stage === 'closed') fields.close_date = itopDate(closedAt);
      if (rnd() < 0.5 && ciIds.length) fields.functionalcis_list = [{ functionalci_id: pick(rnd, ciIds) }];
    }
    fields.status = status;
    await create(cls, fields);
  });
}

async function seedNewsroom(contactId) {
  const present = await getAll('EventNotificationNewsroom', `SELECT EventNotificationNewsroom WHERE contact_id = ${contactId}`, 'id');
  const missing = COUNTS.newsroom - present.length;
  console.log(`  newsroom: ${present.length} present, ${Math.max(0, missing)} to create`);
  if (missing <= 0) return;
  // An action and a trigger to hang them on (never fired: no conditions met).
  const action = (await getAll('ActionNewsroom', "SELECT ActionNewsroom WHERE name = 'Perf bell'", 'name'))[0]?.id ??
    (await create('ActionNewsroom', { name: 'Perf bell', status: 'disabled', title: '$this->friendlyname$', message: 'perf', recipients: 'SELECT Person WHERE id = 0' }));
  const trigger = (await getAll('TriggerOnObjectCreate', "SELECT TriggerOnObjectCreate WHERE description = 'Perf bell'", 'description'))[0]?.id ??
    (await create('TriggerOnObjectCreate', { description: 'Perf bell', target_class: 'UserRequest', filter: 'SELECT UserRequest WHERE id = 0', action_list: [{ action_id: action }] }));
  const until = UNTIL.getTime();
  const tickets = await getAll('UserRequest', "SELECT UserRequest WHERE title LIKE '%(perf %'", 'ref', 500).then((r) => r.slice(0, 500));
  timings.newsroom = await pool('newsroom', Array.from({ length: missing }, (_, k) => k), async (k) => {
    const rnd = rngFor('news', k);
    const t = tickets[k % Math.max(1, tickets.length)];
    await create('EventNotificationNewsroom', {
      message: `${t?.ref ?? 'A ticket'} was updated`,
      title: `${t?.ref ?? 'Ticket'} updated`,
      contact_id: contactId,
      trigger_id: trigger,
      action_id: action,
      object_class: 'UserRequest',
      object_id: t?.id ?? 0,
      url: t ? `${URL_}/pages/UI.php?operation=details&class=UserRequest&id=${t.id}` : URL_,
      read: rnd() < 0.7 ? 'yes' : 'no',
      date: itopDate(until - rnd() * 60 * DAY),
      priority: pick(rnd, ['1', '2', '3', '4']),
    });
  });
}

main().catch((error) => {
  console.error('\nperf-seed failed:', error);
  process.exit(1);
});
