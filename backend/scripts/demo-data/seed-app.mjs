#!/usr/bin/env node
/**
 * The second half of the demonstration data (seed.mjs first): what the app
 * keeps in its own database rather than in the system of record. Settings go
 * through the app's own services, as the installation's administrator inside
 * its customer; dated history (time logged, drafts) is written to the app's
 * tables with past dates. Run in a one-off container of the BFF image:
 *
 *   docker run --rm --network arcus_itop --env-file /opt/arcus/shared/prod.env \
 *     -v /opt/arcus/demo:/work --entrypoint node <bff image> /work/seed-app.mjs
 *
 * Needs /work/manifest.jsonl from seed.mjs. Adds its own lines to it
 * (kind "app") so the clean-up knows what to remove.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

// prod.env writes values in single quotes; docker --env-file keeps them.
for (const [k, v] of Object.entries(process.env)) if (/^'.*'$/s.test(v ?? '')) process.env[k] = v.slice(1, -1);

const require = createRequire('/app/package.json');
const mysql = require('mysql2/promise');
const { loadConfig } = await import('/app/dist/config/env.js');
const { buildServices } = await import('/app/dist/services.js');
const { runAs, runAsServiceAccount } = await import('/app/dist/core/request-context.js');

const WORK = '/work';
const DAY = 86_400_000;
const NOW = Date.now();
let seed = 1124;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (l) => l[Math.floor(rnd() * l.length)];
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const sqlDate = (ms) => new Date(ms).toISOString().slice(0, 23).replace('T', ' ');

const manifest = new Map();
for (const line of readFileSync(`${WORK}/manifest.jsonl`, 'utf8').split('\n')) {
  if (!line) continue;
  const r = JSON.parse(line);
  manifest.set(r.key, r.id);
}
const id = (key) => {
  const v = manifest.get(key);
  if (v === undefined) throw new Error(`not in the manifest: ${key}`);
  return v;
};
const note = (what, key) => appendFileSync(`${WORK}/manifest.jsonl`, JSON.stringify({ cls: 'app', kind: what, key }) + '\n');

const config = loadConfig();
const services = buildServices(config);
const tenantRow = (await services.tenantStore.list()).find((t) => t.id === 'iraops');
if (!tenantRow) throw new Error('No tenant "iraops": run tenants set first.');
const tenant = { id: 'iraops', name: tenantRow.name, orgIds: tenantRow.orgIds ?? tenantRow.organizations ?? [] };
// Lookups as the service account, inside the customer.
const call = (op, args) => runAs(undefined, () => runAsServiceAccount(() => services.client.call(op, args)), tenant);
const objs = (r) => Object.values(r.objects ?? {}).map((o) => ({ id: Number(o.key), ...o.fields }));
const admin = objs(await call('core/get', { class: 'User', key: "SELECT User WHERE login = 'admin'", output_fields: 'login,contactid' }))[0];
const caller = (name = 'IRAOPS Admin', login = 'admin') => ({
  userId: admin.id, login, contactId: Number(admin.contactid) || 1, name, email: '', kind: 'staff', profiles: ['Administrator'], isAdmin: true,
  allowedOrgIds: [], orgId: 1, credentials: { user: config.itop.user, password: config.itop.password },
});
const as = (fn, name, login) => runAs(caller(name, login), fn, tenant);
const step = async (label, fn) => {
  try { const r = await fn(); console.log(`${label}: ${r ?? 'ok'}`); } catch (e) { console.log(`${label}: FAILED ${e.message}`); }
};

// --- Assignment rules: where new tickets go -------------------------------------
await step('assignment rules', () => as(async () => {
  const sub = (svc, name) => String(id(`sub:${svc}:${name}`));
  const team = (t) => String(id(`team:${t}`));
  const rules = [
    ['Network outages to Network Operations', 'incident', undefined, 'Office Network', 'No network connection', 'Network Operations'],
    ['Site internet outages to Network Operations', 'incident', undefined, 'Internet & WAN', 'Site internet outage', 'Network Operations'],
    ['Wi-Fi to Network Operations', 'incident', undefined, 'Wi-Fi', 'Wi-Fi drops or no signal', 'Network Operations'],
    ['VPN problems to Network Operations', 'incident', undefined, 'Remote Access', 'VPN cannot connect', 'Network Operations'],
    ['Server alerts to Server & Cloud', 'incident', undefined, 'Servers & Virtualisation', 'Server down or unresponsive', 'Server & Cloud'],
    ['Backup failures to Server & Cloud', 'incident', undefined, 'Backup & Recovery', 'Backup job failed', 'Server & Cloud'],
    ['Malware alerts to Security Operations', 'incident', undefined, 'Endpoint Protection', 'Malware alert', 'Security Operations'],
    ['Phishing reports to Security Operations', 'incident', undefined, 'Email Security', 'Phishing email reported', 'Security Operations'],
    ['ERP issues to Business Applications', 'incident', undefined, 'ERP (Microsoft Dynamics 365)', 'ERP error or slowness', 'Business Applications'],
    ['Clinic HIS issues to Business Applications', 'incident', 'MBM', 'Clinical Systems (HIS)', 'HIS module error', 'Business Applications'],
    ['POS faults to Business Applications', 'incident', undefined, 'Point of Sale', 'POS terminal fault', 'Business Applications'],
    ['Abu Dhabi hardware to Desktop Support - Abu Dhabi', 'incident', 'MBM', 'Laptops & Desktops', 'Hardware fault', 'Desktop Support - Abu Dhabi'],
    ['New laptops to Desktop Support - Dubai', 'service_request', undefined, 'Laptops & Desktops', 'New laptop or desktop', 'Desktop Support - Dubai'],
    ['New starters to Service Desk', 'service_request', undefined, 'User Accounts', 'New starter account', 'Service Desk'],
    ['Firewall changes to Network Operations', 'service_request', undefined, 'Internet & WAN', 'Firewall rule change', 'Network Operations'],
  ].map(([name, type, org, svc, sb, t], i) => ({
    id: `r${String(i + 1).padStart(2, '0')}`, name, enabled: true, ticketType: type,
    ...(org ? { organizationId: String(id(`org:${org}`)) } : {}),
    serviceId: String(id(`service:${svc}`)), serviceSubcategoryId: sub(svc, sb), teamId: team(t),
  }));
  await services.dispatch.saveRules({ rules, notifyTeam: false });
  note('assignment-rules', 'iraops');
  return `${rules.length} rules`;
}));

// --- Request forms: extra questions on catalogue items ----------------------------
const FORMS = [
  ['Laptops & Desktops', 'New laptop or desktop', [
    { key: 'start_date', label: 'Start date', type: 'date', required: true },
    { key: 'role', label: 'Job title', type: 'text', required: true },
    { key: 'device', label: 'Device', type: 'choice', required: true, options: ['Standard laptop (Latitude 5440)', 'Executive laptop (X1 Carbon)', 'Engineering workstation', 'Desktop (OptiPlex)', 'MacBook Air'] },
    { key: 'accessories', label: 'Accessories', type: 'textarea', required: false, help: 'Docking station, monitors, headset...' },
  ]],
  ['User Accounts', 'New starter account', [
    { key: 'start_date', label: 'First working day', type: 'date', required: true },
    { key: 'department', label: 'Department', type: 'text', required: true },
    { key: 'line_manager', label: 'Line manager', type: 'text', required: true },
    { key: 'systems', label: 'Systems needed', type: 'textarea', required: false, help: 'ERP, CRM, shared folders, VPN...' },
  ]],
  ['User Accounts', 'Leaver account removal', [
    { key: 'last_day', label: 'Last working day', type: 'date', required: true },
    { key: 'forward_to', label: 'Forward email to', type: 'text', required: false },
    { key: 'devices', label: 'Devices to collect', type: 'textarea', required: false },
  ]],
  ['Software Installation', 'Software licence request', [
    { key: 'software', label: 'Software', type: 'choice', required: true, options: ['Adobe Acrobat Pro', 'Microsoft Visio', 'Microsoft Project', 'AutoCAD LT', 'Power BI Pro', 'Other'] },
    { key: 'business_reason', label: 'Business reason', type: 'textarea', required: true },
    { key: 'cost_centre', label: 'Cost centre', type: 'text', required: true },
  ]],
  ['Internet & WAN', 'Firewall rule change', [
    { key: 'source', label: 'Source (IP or network)', type: 'text', required: true },
    { key: 'destination', label: 'Destination (IP or network)', type: 'text', required: true },
    { key: 'port', label: 'Port and protocol', type: 'text', required: true, help: 'For example TCP 443' },
    { key: 'until', label: 'Needed until', type: 'date', required: false },
  ]],
  ['Servers & Virtualisation', 'New virtual machine', [
    { key: 'os', label: 'Operating system', type: 'choice', required: true, options: ['Windows Server 2022', 'Ubuntu 22.04 LTS', 'Red Hat Enterprise Linux 9'] },
    { key: 'vcpu', label: 'vCPUs', type: 'number', required: true },
    { key: 'ram_gb', label: 'Memory (GB)', type: 'number', required: true },
    { key: 'purpose', label: 'Purpose', type: 'textarea', required: true },
  ]],
  ['Remote Access', 'VPN access request', [
    { key: 'reason', label: 'Why remote access is needed', type: 'textarea', required: true },
    { key: 'until', label: 'Access until', type: 'date', required: false, help: 'Leave empty for permanent access' },
  ]],
  ['Wi-Fi', 'Guest Wi-Fi access', [
    { key: 'guests', label: 'Number of guests', type: 'number', required: true },
    { key: 'from', label: 'From', type: 'date', required: true },
    { key: 'to', label: 'To', type: 'date', required: true },
    { key: 'company', label: 'Guest company', type: 'text', required: false },
  ]],
];
await step('request forms', () => as(async () => {
  for (const [svc, sub, fields] of FORMS) {
    const sid = id(`sub:${svc}:${sub}`);
    await services.requestForms.save('subcategory', sid, fields);
    note('request-form', `subcategory:${sid}`);
  }
  return `${FORMS.length} forms`;
}));

// --- Auto-close ------------------------------------------------------------------
await step('auto-close', () => as(async () => {
  await services.autoClose.save({ enabled: true, days: 5, requests: true, incidents: true, remind: false, remindDaysBefore: 2 });
  note('auto-close', 'iraops');
}));

// --- Change blackouts -------------------------------------------------------------
await step('change blackouts', () => as(async () => {
  const list = [
    ['UAE National Day freeze', '2026-11-30T00:00:00+04:00', '2026-12-04T00:00:00+04:00', 'National Day holidays: only emergency changes.'],
    ['Year-end change freeze', '2026-12-20T00:00:00+04:00', '2027-01-04T00:00:00+04:00', 'Year-end closing at all clients: no planned changes.'],
    ['Retail peak - Dubai Shopping Festival', '2026-12-11T00:00:00+04:00', '2027-01-25T00:00:00+04:00', 'Sahraa Retail stores at peak: no POS or network changes.'],
    ['Corniche Capital quarter-end', '2026-12-28T00:00:00+04:00', '2027-01-03T00:00:00+04:00', 'Quarter-end reporting: core banking interfaces frozen.'],
  ];
  const existing = new Set((await services.changeCalendar.blackouts()).map((b) => b.name));
  let n = 0;
  for (const [name, start, end, reason] of list) {
    if (existing.has(name)) continue;
    const b = await services.changeCalendar.createBlackout({ name, start: new Date(start).toISOString(), end: new Date(end).toISOString(), reason });
    note('blackout', b.id);
    n++;
  }
  return `${n} blackouts`;
}));

// --- Post-implementation reviews of finished changes ------------------------------------
const changes = objs(await call('core/get', { class: 'Change', key: "SELECT Change WHERE status IN ('implemented','monitored','closed')", output_fields: 'ref,title,status,finalclass' }));
const sm = objs(await call('core/get', { class: 'Person', key: `SELECT Person AS p JOIN lnkPersonToTeam AS l ON l.person_id = p.id WHERE l.team_id = ${id('team:Service Management')}`, output_fields: 'first_name,name' }));
await step('post-implementation reviews', async () => {
  let n = 0;
  for (const c of changes.filter((_, i) => i % 2 === 0).slice(0, 40)) {
    const who = pick(sm);
    const outcome = rnd() < 0.82 ? 'successful' : rnd() < 0.6 ? 'partial' : 'rolled_back';
    const body = {
      outcome,
      wentWell: pick(['Completed inside the maintenance window with no user impact.', 'Pre-checks and the rollback plan were ready; the client was informed in advance.', 'Smooth implementation; monitoring stayed green throughout.']),
      wentBadly: outcome === 'successful' ? pick(['', 'Change window started 20 minutes late waiting for site access.', '']) : pick(['One site needed a second visit to finish.', 'Vendor firmware took longer than planned; rolled back and rescheduled.']),
      incidents: [],
      followUps: outcome === 'successful' ? [] : [{ text: 'Reschedule the remaining part and update the runbook.', owner: `${who.first_name} ${who.name}`, due: ymd(NOW + 14 * DAY), done: false }],
    };
    try {
      await runAs(caller(`${who.first_name} ${who.name}`), () => services.changePir.save(c.id, body), tenant);
      note('pir', String(c.id));
      n++;
    } catch (e) { if (n === 0) throw e; }
  }
  return `${n} reviews`;
});

// --- Knowledge: settings and staff feedback ----------------------------------------
await step('knowledge settings', () => as(() => services.knowledge.saveSettings({ reviewerProfiles: ['Service Desk Agent', 'Support Agent'], reviewIntervalDays: 180 })));
const faqs = objs(await call('core/get', { class: 'FAQ', key: 'SELECT FAQ', output_fields: 'title' }));
await step('knowledge feedback', async () => {
  let n = 0;
  for (const f of faqs) {
    for (let k = 0; k < 2 + Math.floor(rnd() * 4); k++) {
      const helpful = rnd() < 0.85;
      try {
        await as(() => services.knowledge.feedback('faq', f.id, { helpful, comment: helpful ? pick(['Clear and quick.', 'Solved my issue.', '', 'Useful, thanks.']) : pick(['Steps are out of date.', 'Did not cover my case.']) }, 'staff'), `Agent ${k}`, `agent${k}`);
        n++;
      } catch { /* one per person, or not allowed: skip */ }
    }
  }
  note('kb-feedback', 'faq');
  return `${n} ratings`;
});

// --- Time logged (dated history) and drafts --------------------------------------------
const pool = mysql.createPool({ host: process.env.SESSION_DB_HOST || "db", port: Number(process.env.SESSION_DB_PORT || 3306), user: process.env.SESSION_DB_USER, password: process.env.SESSION_DB_PASSWORD, database: process.env.SESSION_DB_NAME, connectionLimit: 2 });
await step('time logged', async () => {
  const [[{ n: existing }]] = await pool.query("SELECT COUNT(*) AS n FROM bff_worklogs WHERE tenant = 'iraops'");
  if (existing > 0) return `${existing} already`;
  const users = new Map(objs(await call('core/get', { class: 'User', key: 'SELECT UserLocal', output_fields: 'contactid' })).map((u) => [Number(u.contactid), u.id]));
  const rows = [];
  for (const cls of ['Incident', 'UserRequest']) {
    const since = new Date(NOW - 75 * DAY).toISOString().slice(0, 10);
    const tickets = objs(await call('core/get', { class: cls, key: `SELECT ${cls} WHERE start_date > '${since}' AND agent_id != 0`, output_fields: 'ref,org_id,agent_id,agent_name,start_date,resolution_date' }));
    for (const t of tickets) {
      const entries = 1 + Math.floor(rnd() * 3);
      const start = Date.parse(t.start_date.replace(' ', 'T') + 'Z');
      const end = t.resolution_date ? Date.parse(t.resolution_date.replace(' ', 'T') + 'Z') : Math.min(NOW, start + 3 * DAY);
      for (let e = 0; e < entries; e++) {
        const when = start + (end - start) * ((e + 1) / (entries + 1));
        rows.push([cls, t.id, t.ref, Number(t.org_id), users.get(Number(t.agent_id)) ?? 0, Number(t.agent_id), t.agent_name, pick([10, 15, 15, 20, 30, 30, 45, 60, 90, 120]),
          pick(['Remote session with the user, applied the fix.', 'Investigated logs and monitoring.', 'On-site visit.', 'Called the user and confirmed.', 'Configured and tested.', 'Coordinated with the vendor.', 'Documented the steps in the ticket.']),
          ymd(when), sqlDate(when)]);
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    await pool.query('INSERT INTO bff_worklogs (tenant, class, ticket_id, ticket_ref, org_id, user_id, contact_id, agent_name, minutes, note, work_date, created_at) VALUES ' + rows.slice(i, i + 500).map(() => "('iraops',?,?,?,?,?,?,?,?,?,?,?)").join(','), rows.slice(i, i + 500).flat());
  }
  note('worklogs', 'iraops');
  return `${rows.length} entries`;
});
await step('drafts', async () => {
  const [[{ n: existing }]] = await pool.query("SELECT COUNT(*) AS n FROM bff_drafts WHERE tenant = 'iraops'");
  if (existing > 0) return `${existing} already`;
  const drafts = [
    ['incident', 'Intermittent Wi-Fi drops on the 3rd floor - Wadi Crest', { title: 'Intermittent Wi-Fi drops on the 3rd floor', description: 'Users report drops every 10-15 minutes, waiting for the heat map from NOC.' }],
    ['incident', 'Label printer offline at Jebel Ali hub', { title: 'Label printer offline at Jebel Ali hub', description: 'Zebra ZD421 not reachable since the switch replacement.' }],
    ['user-request', 'Onboarding batch - 6 nurses for Marjan Bay Al Reem', { title: 'Onboarding batch - 6 nurses for Marjan Bay Al Reem', description: 'HIS, email and badge access for six new staff nurses starting on the 1st.' }],
    ['user-request', 'Meeting room AV upgrade quote - Palmhaven Sales Gallery', { title: 'Meeting room AV upgrade', description: 'Collect requirements for two rooms; ask for Teams Rooms certified kit.' }],
  ];
  for (const [kind, title, data] of drafts) {
    const at = sqlDate(NOW - (1 + rnd() * 5) * DAY);
    await pool.query('INSERT INTO bff_drafts (id, tenant, user_id, kind, title, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [randomBytes(12).toString('hex'), 'iraops', admin.id, kind, title, JSON.stringify(data), at, at]);
  }
  note('drafts', 'iraops');
  return `${drafts.length} drafts`;
});

await pool.end();
await services.sessions.close?.();
console.log('app data done');
process.exit(0);
