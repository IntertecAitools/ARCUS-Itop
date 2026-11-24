#!/usr/bin/env node
/**
 * Fills an installation with realistic demonstration data (content.mjs): an
 * IT provider and its client companies, six months of history. Run on the
 * server, in a one-off container of the BFF image on the system-of-record's
 * network, with prod.env (ITOP_BASE_URL, ITOP_USER, ITOP_PASSWORD):
 *
 *   docker run --rm --network arcus_itop --env-file /opt/arcus/shared/prod.env \
 *     -v /opt/arcus/demo:/work --entrypoint node <bff image> /work/seed.mjs
 *
 * Writes /work/manifest.jsonl (every record it created: class, id, key) so
 * the data can be removed again, and /work/sla.sql (the SLA timers of the
 * history, which the system of record only runs in real time), applied by the
 * caller. Re-running skips what the manifest already has.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as C from './content.mjs';

// prod.env writes values in single quotes; docker --env-file keeps them.
const env = (k) => (process.env[k] ?? '').replace(/^'(.*)'$/s, '$1');
const BASE = (env('ITOP_BASE_URL') || 'http://itop').replace(/\/+$/, '');
const USER = env('ITOP_USER');
const PASSWORD = env('ITOP_PASSWORD');
const WORK = process.env.DEMO_WORK || '/work';
const CONCURRENCY = Number(process.env.DEMO_CONCURRENCY || 10);
const SCALE = Number(process.env.DEMO_SCALE || 1);
const COMMENT = 'Data migration from the previous service desk';
const NOW = Date.now();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const SPAN_DAYS = 182;

// --- randomness (seeded: the same run gives the same data) --------------------
let seed = 20261124;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];
const weighted = (map) => {
  const r = rnd();
  let acc = 0;
  for (const [k, w] of Object.entries(map)) if ((acc += w) >= r) return k;
  return Object.keys(map)[0];
};
const itopDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// --- manifest -----------------------------------------------------------------
const MANIFEST = `${WORK}/manifest.jsonl`;
const done = new Map();
if (existsSync(MANIFEST)) {
  for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    done.set(r.key, r.id);
  }
}
const record = (cls, id, key) => {
  done.set(key, id);
  appendFileSync(MANIFEST, JSON.stringify({ cls, id, key }) + '\n');
};

// --- REST ---------------------------------------------------------------------
let calls = 0;
async function rest(payload, attempt = 0) {
  calls++;
  const body = new URLSearchParams({ auth_user: USER, auth_pwd: PASSWORD, json_data: JSON.stringify(payload) });
  try {
    const res = await fetch(`${BASE}/webservices/rest.php?version=1.4`, { method: 'POST', body });
    const json = JSON.parse(await res.text());
    if (json.code !== 0) throw new Error(`code ${json.code}: ${json.message}`);
    return json;
  } catch (e) {
    if (attempt < 3 && !/code (1|2|3|4|5|100)\b/.test(String(e.message))) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return rest(payload, attempt + 1);
    }
    throw e;
  }
}
const objs = (j) => Object.values(j.objects ?? {});
async function getAll(cls, oql, fields) {
  return objs(await rest({ operation: 'core/get', class: cls, key: oql, output_fields: fields })).map((o) => ({ id: Number(o.key), ...o.fields }));
}
/** Creates once per key (manifest); returns the id. */
async function make(cls, key, fields) {
  if (done.has(key)) return done.get(key);
  if (cls === 'Organization') {
    const found = await getAll('Organization', `SELECT Organization WHERE name = '${String(fields.name).replace(/'/g, "\\'")}'`, 'name');
    if (found.length) { record(cls, found[0].id, key); return found[0].id; }
  }
  // Catalogue entries the installation may already have: reuse them, and
  // mark them so a clean-up never removes them.
  if (['Brand', 'Model', 'OSFamily', 'OSVersion', 'NetworkDeviceType', 'FAQCategory', 'ServiceFamily', 'ContractType'].includes(cls)) {
    const q = String(fields.name).replace(/'/g, "\\'");
    const extra = cls === 'Model' ? ` AND brand_id = ${fields.brand_id}` : cls === 'OSVersion' ? ` AND osfamily_id = ${fields.osfamily_id}` : '';
    const found = await getAll(cls, `SELECT ${cls} WHERE name = '${q}'${extra}`, 'name');
    if (found.length) {
      done.set(key, found[0].id);
      appendFileSync(MANIFEST, JSON.stringify({ cls, id: found[0].id, key, existing: true }) + '\n');
      return found[0].id;
    }
  }
  const id = Number(objs(await rest({ operation: 'core/create', comment: COMMENT, class: cls, fields, output_fields: 'id' }))[0].key);
  record(cls, id, key);
  return id;
}
async function pool(label, items, job) {
  const t0 = Date.now();
  let next = 0, ok = 0, failed = 0;
  const errors = new Map();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await job(item); ok++; } catch (e) {
        failed++;
        const k = String(e.message).slice(0, 200);
        errors.set(k, (errors.get(k) ?? 0) + 1);
      }
    }
  }));
  console.log(`${label}: ${ok} ok, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const [m, n] of errors) console.log(`   ${n}x ${m}`);
}

// --- people -------------------------------------------------------------------
const usedNames = new Set();
function personName() {
  for (;;) {
    const bg = weighted(C.MIX);
    const first = pick(C.FIRST_NAMES[bg]);
    const last = pick(C.LAST_NAMES[bg]);
    if (!usedNames.has(`${first} ${last}`)) { usedNames.add(`${first} ${last}`); return [first, last]; }
  }
}
const phone = () => `+971 5${pick(['0', '2', '4', '5', '6', '8'])} ${String(Math.floor(rnd() * 900) + 100)} ${String(Math.floor(rnd() * 9000) + 1000)}`;
const office = (city) => `+971 ${{ Dubai: '4', 'Abu Dhabi': '2', Sharjah: '6', 'Al Ain': '3', 'Ras Al Khaimah': '7' }[city] ?? '4'} ${String(Math.floor(rnd() * 900) + 100)} ${String(Math.floor(rnd() * 9000) + 1000)}`;

async function main() {
  const t0 = Date.now();
  console.log(`demo data into ${BASE}, ${done.size} records already in the manifest`);

  // Organisations: the provider is the installation's own (id 1, renamed already).
  const provider = (await getAll('Organization', 'SELECT Organization WHERE id = 1', 'name'))[0];
  const providerId = provider.id;
  const orgByCode = { IRA: providerId };
  const clientByCode = {};
  for (const [name, code, domain, sector, staff, city] of C.CLIENTS) {
    orgByCode[code] = await make('Organization', `org:${code}`, { name, code, parent_id: 0 });
    clientByCode[code] = { name, code, domain, sector, staff: Math.round(staff * SCALE), city };
  }
  const vendorIds = {};
  for (const [, vendor] of C.PROVIDER_CONTRACTS) vendorIds[vendor] = await make('Organization', `vendor:${vendor}`, { name: vendor });
  console.log('organisations ok');

  // Locations.
  const locations = {};
  await pool('locations', C.LOCATIONS, async ([code, name, address, city, postal]) => {
    const id = await make('Location', `loc:${name}`, { name, org_id: orgByCode[code], address, city, country: 'United Arab Emirates', postal_code: postal, status: 'active' });
    (locations[code] ??= []).push({ id, name, city });
  });
  const locOf = (code) => pick(locations[code] ?? locations.IRA);

  // IT staff and teams.
  const staff = [];
  const teamMembers = {};
  for (const [team, , , members] of C.TEAMS) {
    for (let i = 0; i < members; i++) {
      const [first, last] = personName();
      const loc = team.endsWith('Abu Dhabi') ? locations.IRA.find((l) => l.city === 'Abu Dhabi') : pick(locations.IRA);
      staff.push({ first, last, team, fn: i === members - 1 ? C.IT_FUNCTIONS[team].at(-1) : pick(C.IT_FUNCTIONS[team].slice(0, -1).length ? C.IT_FUNCTIONS[team].slice(0, -1) : C.IT_FUNCTIONS[team]), loc });
    }
  }
  await pool('IT staff', staff, async (s) => {
    const email = `${slug(s.first)}.${slug(s.last)}@${C.PROVIDER_DOMAIN}`;
    s.id = await make('Person', `person:${email}`, { first_name: s.first, name: s.last, email, org_id: providerId, function: s.fn, phone: office(s.loc.city), mobile_phone: phone(), location_id: s.loc.id, employee_number: `IRA-${1000 + staff.indexOf(s)}`, notify: 'no' });
    (teamMembers[s.team] ??= []).push(s);
  });
  const teams = {};
  await pool('teams', C.TEAMS, async ([name, fn, mail]) => {
    teams[name] = await make('Team', `team:${name}`, { name, org_id: providerId, function: fn, email: `${mail}@${C.PROVIDER_DOMAIN}`, phone: '+971 4 512 7700', notify: 'no', persons_list: (teamMembers[name] ?? []).map((p) => ({ person_id: p.id })) });
  });

  // Client employees.
  const clientPeople = {};
  const people = [];
  for (const c of Object.values(clientByCode)) {
    for (let i = 0; i < c.staff; i++) {
      const [first, last] = personName();
      people.push({ first, last, code: c.code, fn: pick(C.CLIENT_FUNCTIONS[c.sector]), loc: locOf(c.code), domain: c.domain, n: i });
    }
  }
  await pool('client people', people, async (p) => {
    const email = `${slug(p.first)}.${slug(p.last)}@${p.domain}`;
    p.id = await make('Person', `person:${email}`, { first_name: p.first, name: p.last, email, org_id: orgByCode[p.code], function: p.fn, phone: office(p.loc.city), mobile_phone: phone(), location_id: p.loc.id, employee_number: `${p.code}-${2001 + p.n}`, notify: 'no' });
    (clientPeople[p.code] ??= []).push(p);
  });

  // Accounts: IT staff as agents, some client staff on the portal. Random
  // passwords nobody knows: nobody signs in as these.
  const profiles = Object.fromEntries((await getAll('URP_Profiles', 'SELECT URP_Profiles', 'name')).map((r) => [r.name, r.id]));
  const secret = () => `${randomBytes(18).toString('base64url')}aA1!`;
  const accounts = [
    ...staff.map((s) => ({ s, login: `${slug(s.first)}.${slug(s.last)}`, profiles: s.team === 'Service Management' ? ['Support Agent', 'Change Supervisor', 'Problem Manager'] : ['Support Agent'] })),
    ...Object.values(clientPeople).flatMap((list) => list.slice(0, 4)).map((s) => ({ s, login: `${slug(s.first)}.${slug(s.last)}`, profiles: ['Portal user'] })),
  ];
  await pool('accounts', accounts, async (a) => {
    await make('UserLocal', `user:${a.login}`, { login: a.login, contactid: a.s.id, password: secret(), language: 'EN US', status: 'enabled', profile_list: a.profiles.filter((p) => profiles[p]).map((p) => ({ profileid: profiles[p] })) });
  });

  // Service catalogue.
  const services = {};
  const subs = [];
  for (const [family, list] of C.CATALOGUE) {
    const famId = await make('ServiceFamily', `family:${family}`, { name: family });
    await pool(`services ${family}`, list, async ([svc, subList]) => {
      const sid = await make('Service', `service:${svc}`, { name: svc, org_id: providerId, servicefamily_id: famId, status: 'production', description: `${svc} for client staff, provided by the IRAOPS service desk.` });
      services[svc] = sid;
      for (const [sub, type, team] of subList) {
        const id = await make('ServiceSubcategory', `sub:${svc}:${sub}`, { name: sub, service_id: sid, request_type: type, status: 'production', description: `${sub} (${svc}).` });
        subs.push({ id, name: sub, type, team, service: svc, sid });
      }
    });
  }

  // Service levels: one SLA per tier, SLTs per priority.
  const slas = {};
  for (const [tier, t] of Object.entries(C.TIERS)) {
    const slts = [];
    for (const type of ['incident', 'service_request']) {
      for (const metric of ['tto', 'ttr']) {
        for (let p = 1; p <= 4; p++) {
          const hours = t[metric][p - 1] * (type === 'service_request' ? 2 : 1);
          const minutes = hours < 1;
          slts.push(await make('SLT', `slt:${tier}:${type}:${metric}:${p}`, { name: `${tier} ${type === 'incident' ? 'Incident' : 'Request'} ${metric.toUpperCase()} P${p}`, priority: String(p), request_type: type, metric, value: String(minutes ? Math.round(hours * 60) : hours), unit: minutes ? 'minutes' : 'hours' }));
        }
      }
    }
    slas[tier] = await make('SLA', `sla:${tier}`, { name: `${tier} Support`, org_id: providerId, description: `${tier} service levels (${t.window === '24x7' ? '24x7' : 'business hours'}).`, slts_list: slts.map((id) => ({ slt_id: id })) });
  }
  // Business hours and holidays.
  try {
    const cal = await make('HolidayCalendar', 'cal:UAE', { name: 'UAE public holidays 2026' });
    for (const [name, date] of C.HOLIDAYS) await make('Holiday', `hol:${date}`, { name, date, calendar_id: cal });
    await make('CoverageWindow', 'cw:business', { name: 'UAE business hours (Mon-Fri 08:00-18:00)', interval_list: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => ({ weekday: d, start_time: '08:00', end_time: '18:00' })) });
    await make('CoverageWindow', 'cw:24x7', { name: '24x7', interval_list: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => ({ weekday: d, start_time: '00:00', end_time: '23:59' })) });
  } catch (e) { console.log(`calendars: ${e.message}`); }

  // Contracts: one per client with its tier, the provider's supplier contracts.
  const sectorOk = (svc, sector) => !C.SECTOR_SERVICES[svc] || C.SECTOR_SERVICES[svc].includes(sector);
  await pool('customer contracts', Object.values(clientByCode), async (c) => {
    const tier = C.CLIENT_TIER[c.code];
    const start = new Date(2025, Math.floor(rnd() * 12), 1).getTime();
    await make('CustomerContract', `cc:${c.code}`, {
      name: `${c.name} - Managed IT Services (${tier})`, org_id: orgByCode[c.code], provider_id: providerId, status: 'production',
      start_date: day(start), end_date: day(start + 3 * 365 * DAY), cost: String(Math.round((c.staff * 120 + 40000) / 100) * 100), cost_currency: 'dollars', cost_unit: 'per month', billing_frequency: 'monthly',
      description: `Managed IT services for ${c.name}: service desk, end-user support, network, servers and applications. ${tier} service levels.`,
      services_list: Object.entries(services).filter(([svc]) => sectorOk(svc, c.sector)).map(([, sid]) => ({ service_id: sid, sla_id: slas[tier] })),
    });
  });
  await pool('supplier contracts', C.PROVIDER_CONTRACTS, async ([name, vendor, cost]) => {
    await make('ProviderContract', `pc:${name}`, { name, org_id: providerId, provider_id: vendorIds[vendor], status: 'production', start_date: '2025-07-01', end_date: '2027-06-30', cost: String(cost), cost_currency: 'dollars', cost_unit: 'per year', billing_frequency: 'yearly', description: `${name}, held by IRAOPS for client services.` });
  });

  // Equipment catalogue.
  const brands = {};
  const models = [];
  for (const [brand, list] of C.MODELS) {
    brands[brand] = await make('Brand', `brand:${brand}`, { name: brand });
    for (const [model, type] of list) models.push({ brand, model, type, id: await make('Model', `model:${brand}:${model}`, { name: model, brand_id: brands[brand], type }) });
  }
  const osv = {};
  for (const [fam, versions] of C.OS) {
    const fid = await make('OSFamily', `osf:${fam}`, { name: fam });
    for (const v of versions) osv[v] = { fid, id: await make('OSVersion', `osv:${v}`, { name: v, osfamily_id: fid }) };
  }
  const ndTypes = {};
  for (const t of ['Switch', 'Firewall', 'Wireless access point', 'Router']) ndTypes[t] = await make('NetworkDeviceType', `ndt:${t}`, { name: t });
  console.log('catalogue ok');

  // Configuration items per client.
  const cis = {};
  const ciPlan = [];
  const modelsOf = (type) => models.filter((m) => m.type === type);
  const serial = () => Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(rnd() * 34)]).join('');
  for (const c of Object.values(clientByCode)) {
    const n = c.staff;
    const push = (cls, name, extra) => ciPlan.push({ cls, code: c.code, name, extra });
    for (let i = 0; i < n; i++) {
      const m = pick(modelsOf('PC'));
      const loc = locOf(c.code);
      const win = m.brand === 'Apple' ? 'macOS Sonoma 14' : pick(['Windows 11 Enterprise 23H2', 'Windows 11 Enterprise 23H2', 'Windows 11 Enterprise 22H2', 'Windows 10 Enterprise 22H2']);
      const bought = NOW - (200 + rnd() * 1100) * DAY;
      push('PC', `${c.code}-${m.model.includes('OptiPlex') || m.model.includes('EliteDesk') || m.model.includes('ThinkCentre') ? 'DT' : 'LT'}-${String(1001 + i)}`, { type: /OptiPlex|EliteDesk|ThinkCentre/.test(m.model) ? 'desktop' : 'laptop', brand_id: brands[m.brand], model_id: m.id, osfamily_id: osv[win].fid, osversion_id: osv[win].id, location_id: loc.id, serialnumber: serial(), asset_number: `${c.code}-A${String(5000 + i)}`, purchase_date: day(bought), end_of_warranty: day(bought + 3 * 365 * DAY), cpu: pick(['Intel Core i5-1345U', 'Intel Core i7-1365U', 'Apple M2', 'Intel Core i7-13700']), ram: pick(['16 GB', '16 GB', '32 GB', '8 GB']), status: rnd() < 0.92 ? 'production' : pick(['stock', 'implementation']), business_criticity: 'low' });
    }
    for (let i = 0; i < Math.max(2, Math.round(n / 8)); i++) {
      const m = pick(modelsOf('Server'));
      const os = pick(['Windows Server 2022 Standard', 'Windows Server 2022 Standard', 'Windows Server 2019 Standard', 'Ubuntu 22.04 LTS', 'Red Hat Enterprise Linux 9']);
      const role = pick(['FS', 'SQL', 'APP', 'DC', 'WEB', 'BKP']);
      const loc = locOf(c.code);
      push('Server', `${c.code.toLowerCase()}-${role.toLowerCase()}-${String(i + 1).padStart(2, '0')}`, { brand_id: brands[m.brand], model_id: m.id, osfamily_id: osv[os].fid, osversion_id: osv[os].id, location_id: loc.id, serialnumber: serial(), cpu: '2 x Intel Xeon Silver 4410Y', ram: pick(['128 GB', '256 GB', '64 GB']), managementip: `10.${20 + Object.keys(clientByCode).indexOf(c.code)}.1.${10 + i}`, status: 'production', business_criticity: pick(['high', 'high', 'medium']), purchase_date: day(NOW - (300 + rnd() * 900) * DAY) });
    }
    for (const loc of locations[c.code]) {
      const sw = pick(modelsOf('NetworkDevice').filter((m) => m.brand === 'Cisco' && m.model.startsWith('Catalyst')));
      push('NetworkDevice', `${c.code.toLowerCase()}-${slug(loc.name.split(' - ')[1] ?? 'site').slice(0, 10)}-sw01`, { networkdevicetype_id: ndTypes.Switch, brand_id: brands.Cisco, model_id: sw.id, location_id: loc.id, serialnumber: serial(), status: 'production', business_criticity: 'high' });
      const fw = pick(modelsOf('NetworkDevice').filter((m) => m.brand === 'Fortinet'));
      push('NetworkDevice', `${c.code.toLowerCase()}-${slug(loc.name.split(' - ')[1] ?? 'site').slice(0, 10)}-fw01`, { networkdevicetype_id: ndTypes.Firewall, brand_id: brands.Fortinet, model_id: fw.id, location_id: loc.id, serialnumber: serial(), status: 'production', business_criticity: 'high' });
      const ap = models.find((m) => m.model === 'Meraki MR46');
      for (let k = 1; k <= 2; k++) push('NetworkDevice', `${c.code.toLowerCase()}-${slug(loc.name.split(' - ')[1] ?? 'site').slice(0, 10)}-ap0${k}`, { networkdevicetype_id: ndTypes['Wireless access point'], brand_id: brands.Cisco, model_id: ap.id, location_id: loc.id, serialnumber: serial(), status: 'production', business_criticity: 'medium' });
      const pr = pick(modelsOf('Printer'));
      push('Printer', `${c.code}-PRN-${slug(loc.name.split(' - ')[1] ?? 'site').slice(0, 8).toUpperCase()}`, { brand_id: brands[pr.brand], model_id: pr.id, location_id: loc.id, serialnumber: serial(), status: 'production', business_criticity: 'low' });
    }
    for (let i = 0; i < Math.round(n / 3); i++) {
      const m = pick(modelsOf('MobilePhone'));
      push('MobilePhone', `${c.code}-MOB-${String(301 + i)}`, { brand_id: brands[m.brand], model_id: m.id, serialnumber: serial(), imei: String(350000000000000 + Math.floor(rnd() * 99999999999)), phonenumber: phone(), status: 'production', business_criticity: 'low' });
    }
    for (let i = 0; i < Math.round(n / 10); i++) {
      const m = pick(modelsOf('Tablet'));
      push('Tablet', `${c.code}-TAB-${String(101 + i)}`, { brand_id: brands[m.brand], model_id: m.id, serialnumber: serial(), status: 'production', business_criticity: 'low' });
    }
    for (const app of [...C.APPLICATIONS.all, ...(C.APPLICATIONS[c.sector] ?? [])]) {
      push('ApplicationSolution', `${c.code} ${app}`, { status: 'active', business_criticity: /HIS|POS|Core Banking|SCADA|Opera|Micros/.test(app) ? 'high' : pick(['medium', 'high', 'low']), description: `${app} used by ${c.name}.` });
    }
  }
  await pool('assets and applications', ciPlan, async (ci) => {
    const id = await make(ci.cls, `ci:${ci.name}`, { name: ci.name, org_id: orgByCode[ci.code], ...ci.extra });
    (cis[ci.code] ??= []).push({ id, cls: ci.cls, name: ci.name });
  });

  // Tickets ------------------------------------------------------------------
  const slaSql = [];
  const agentsFor = (teamKey, city) => {
    const name = teamKey === 'Desktop' ? (['Abu Dhabi', 'Al Ain', 'Ras Al Khaimah'].includes(city) ? 'Desktop Support - Abu Dhabi' : 'Desktop Support - Dubai') : teamKey;
    return { team: name, members: teamMembers[name] ?? teamMembers['Service Desk'] };
  };
  const fullName = (p) => `${p.first} ${p.last}`;
  const subsByName = Object.fromEntries(subs.map((s) => [s.name, s]));
  const clientList = Object.values(clientByCode);
  const T = Math.round(2200 * SCALE);
  const plan = [];
  for (let i = 0; i < T; i++) {
    const r = rnd();
    plan.push({ i, cls: r < 0.42 ? 'Incident' : r < 0.9 ? 'UserRequest' : r < 0.94 ? 'Change' : 'skip' });
  }
  const tickets = plan.filter((p) => p.cls !== 'skip').map((p, k, all) => {
    // Older tickets first: refs follow time; a bit more recent volume.
    const age = Math.pow(1 - (k + rnd()) / all.length, 1.15) * SPAN_DAYS * DAY;
    // Working hours in the UAE (UTC+4): mostly 05:00-14:00 UTC.
    const d = new Date(NOW - age);
    d.setUTCHours(4 + Math.floor(rnd() * 10), Math.floor(rnd() * 60), 0, 0);
    return { ...p, start: Math.min(d.getTime(), NOW - 20 * 60 * 1000) };
  });

  const created = { Incident: [], UserRequest: [], Change: [] };
  await pool('tickets', tickets, async (t) => {
    const key = `ticket:${t.i}`;
    if (done.has(key)) return;
    const client = pick(clientList);
    const callers = clientPeople[client.code];
    const caller = pick(callers);
    const ageDays = (NOW - t.start) / DAY;
    const tier = C.TIERS[C.CLIENT_TIER[client.code]];
    const r = rnd();
    let stage;
    if (ageDays > 21) stage = r < 0.93 ? 'closed' : r < 0.97 ? 'resolved' : 'assigned';
    else if (ageDays > 5) stage = r < 0.45 ? 'closed' : r < 0.72 ? 'resolved' : r < 0.88 ? 'assigned' : 'pending';
    else stage = r < 0.12 ? 'resolved' : r < 0.6 ? 'assigned' : r < 0.75 ? 'pending' : 'new';

    if (t.cls === 'Change') {
      const [title, desc, reason, plan_, fallback, outage, kind] = pick(C.CHANGES);
      const sm = teamMembers['Service Management'];
      const tech = agentsFor(pick(['Network Operations', 'Server & Cloud', 'Business Applications', 'Security Operations']), client.city);
      const site = locOf(client.code);
      const startCh = t.start + (1 + rnd() * 6) * DAY;
      const status = { new: 'new', assigned: 'assigned', pending: kind === 'RoutineChange' ? 'plannedscheduled' : 'approved', resolved: 'implemented', closed: 'closed' }[stage];
      const fields = {
        title: fill(title, { client: client.name, site: site.name }), description: `<p>${desc}</p>`, org_id: orgByCode[client.code], caller_id: caller.id, reason, fallback, outage,
        implementation_plan: plan_, start_date: itopDate(Math.min(startCh, NOW + 5 * DAY)), end_date: itopDate(Math.min(startCh, NOW + 5 * DAY) + (2 + rnd() * 4) * HOUR), status,
        private_log: { items: [{ date: itopDate(t.start + HOUR), user_login: fullName(pick(sm)), message: 'Change reviewed for risk and impact; scheduled in the maintenance window.' }] },
      };
      if (stage !== 'new') { fields.team_id = teams[tech.team]; fields.agent_id = pick(tech.members).id; fields.manager_id = pick(sm).id; fields.supervisor_id = pick(sm).id; }
      if (stage === 'closed') fields.close_date = itopDate(Math.min(NOW, startCh + 2 * DAY));
      const sCis = (cis[client.code] ?? []).filter((c) => c.cls === 'Server' || c.cls === 'NetworkDevice');
      if (sCis.length) fields.functionalcis_list = [{ functionalci_id: pick(sCis).id }];
      const id = await make(kind, key, fields);
      created.Change.push({ id, kind, stage, start: t.start, sm });
      return;
    }

    const isInc = t.cls === 'Incident';
    const subPool = subs.filter((s) => (isInc ? s.type === 'incident' : s.type === 'service_request') && sectorOk(s.service, client.sector) && (isInc ? C.INCIDENTS[s.name] : C.REQUESTS[s.name]));
    const sub = pick(subPool);
    const story = pick(isInc ? C.INCIDENTS[sub.name] : C.REQUESTS[sub.name]);
    const site = caller.loc;
    const someone = pick(callers);
    const vars = { site: site.name.split(' - ')[1] ?? site.name, floor: `${pick(['Ground', '1st', '2nd', '3rd', '4th', '5th'])} floor`, device: `${client.code}-LT-${1001 + Math.floor(rnd() * client.staff)}`, person: fullName(someone), role: someone.fn, app: pick(C.APPLICATIONS[client.sector] ?? C.APPLICATIONS.all) };
    const [title, desc, steps, fix, code] = isInc ? story : [story[0], story[1], story[2], story[3], 'assistance'];
    const { team, members } = agentsFor(sub.team, site.city);
    const agent = pick(members);
    const impact = isInc ? pick(['3', '3', '2', '2', '1']) : '3';
    const urgency = isInc ? pick(['4', '3', '3', '2', '1']) : pick(['4', '3', '3']);
    const prio = Math.min(4, Math.max(1, Math.round((Number(impact) + Number(urgency)) / 2)));
    const tto = tier.tto[prio - 1] * (isInc ? 1 : 2) * HOUR;
    const ttr = tier.ttr[prio - 1] * (isInc ? 1 : 2) * HOUR;
    // Mostly on time; some late, as in real life.
    const late = rnd() < (isInc ? 0.1 : 0.07);
    const assignedAt = t.start + (late && rnd() < 0.5 ? tto * (1.2 + rnd()) : tto * (0.1 + rnd() * 0.7));
    const resolvedAt = t.start + (late ? ttr * (1.1 + rnd() * 0.8) : ttr * (0.15 + rnd() * 0.75));
    const closedAt = resolvedAt + (1 + rnd() * 3) * DAY;
    const isResolved = stage === 'resolved' || stage === 'closed';
    const fields = {
      title: fill(title, vars), description: `<p>${fill(desc, vars)}</p>`, org_id: orgByCode[client.code], caller_id: caller.id,
      service_id: sub.sid, servicesubcategory_id: sub.id, impact, urgency, origin: pick(isInc ? ['phone', 'mail', 'portal', 'portal', 'chat', 'monitoring'] : ['portal', 'portal', 'mail', 'phone']),
      start_date: itopDate(t.start), last_update: itopDate(Math.min(NOW, isResolved ? (stage === 'closed' ? closedAt : resolvedAt) : assignedAt + rnd() * DAY)),
    };
    if (!isInc) fields.request_type = 'service_request';
    const log = [];
    let at = assignedAt;
    for (const step of steps) {
      at = Math.min(isResolved ? resolvedAt : NOW - HOUR, at + (resolvedAt - assignedAt) / (steps.length + 1));
      log.push({ date: itopDate(at), user_login: fullName(agent), message: fill(step, vars) });
      if (!isResolved && log.length >= 1 + Math.floor(rnd() * steps.length)) break;
    }
    if (stage !== 'new') {
      fields.team_id = teams[team];
      fields.agent_id = agent.id;
      fields.assignment_date = itopDate(assignedAt);
      fields.public_log = { items: [{ date: itopDate(t.start + 2 * 60 * 1000), user_login: fullName(caller), message: fill(desc, vars) }, ...log] };
    }
    if (stage === 'pending') { fields.pending_reason = pick(['Waiting for the user to confirm', 'Waiting for the vendor part', 'Waiting for manager approval', 'User on leave until next week']); }
    if (isResolved) {
      fields.resolution_date = itopDate(resolvedAt);
      fields.resolution_code = code;
      fields.solution = fill(fix, vars);
      fields.time_spent = String(Math.round((20 + rnd() * 160) * 60));
    }
    if (stage === 'closed') {
      fields.close_date = itopDate(Math.min(NOW, closedAt));
      fields.user_satisfaction = weighted({ 1: 0.62, 2: 0.28, 3: 0.07, 4: 0.03 });
      if (rnd() < 0.3) fields.user_comment = pick(['Quick and friendly, thank you.', 'Solved on the first call.', 'Took a bit long but fixed.', 'Great support as always.', 'Engineer explained everything clearly.']);
    }
    if (isInc && prio === 1 && rnd() < 0.25) fields.major_incident = 'yes';
    const myCis = (cis[client.code] ?? []).filter((c) => (sub.service === 'Laptops & Desktops' ? c.cls === 'PC' : sub.service.includes('Print') ? c.cls === 'Printer' : sub.service.includes('Network') || sub.service.includes('Wi-Fi') || sub.service.includes('Internet') ? c.cls === 'NetworkDevice' : sub.service.includes('Server') || sub.service.includes('Backup') ? c.cls === 'Server' : c.cls === 'ApplicationSolution'));
    if (myCis.length && rnd() < 0.7) fields.functionalcis_list = [{ functionalci_id: pick(myCis).id }];
    fields.status = stage;
    const id = await make(t.cls, key, fields);
    created[t.cls].push({ id, sub: sub.name, client: client.code });

    // The SLA timers, as the system of record would have run them.
    const table = isInc ? 'ticket_incident' : 'ticket_request';
    const s = (ms) => `'${itopDate(ms)}'`;
    const ttoStop = stage === 'new' ? null : assignedAt;
    const ttrStop = isResolved ? resolvedAt : null;
    const ttoPassed = (ttoStop ?? NOW) > t.start + tto ? 1 : 0;
    const ttrPassed = (ttrStop ?? NOW) > t.start + ttr ? 1 : 0;
    slaSql.push(`UPDATE ${table} SET tto_started=${s(t.start)}, tto_laststart=${s(t.start)}, tto_stopped=${ttoStop ? s(ttoStop) : 'NULL'}, tto_timespent=${Math.round(((ttoStop ?? NOW) - t.start) / 1000)}, tto_100_deadline=${s(t.start + tto)}, tto_100_passed=${ttoPassed}, tto_100_triggered=${ttoPassed}, tto_100_overrun=${ttoPassed ? Math.round(((ttoStop ?? NOW) - t.start - tto) / 1000) : 'NULL'}, tto_75_deadline=${s(t.start + tto * 0.75)}, tto_75_passed=${(ttoStop ?? NOW) > t.start + tto * 0.75 ? 1 : 0}, ttr_started=${s(t.start)}, ttr_laststart=${s(t.start)}, ttr_stopped=${ttrStop ? s(ttrStop) : 'NULL'}, ttr_timespent=${Math.round(((ttrStop ?? NOW) - t.start) / 1000)}, ttr_100_deadline=${s(t.start + ttr)}, ttr_100_passed=${ttrPassed}, ttr_100_triggered=${ttrPassed}, ttr_100_overrun=${ttrPassed ? Math.round(((ttrStop ?? NOW) - t.start - ttr) / 1000) : 'NULL'}, ttr_75_deadline=${s(t.start + ttr * 0.75)}, ttr_75_passed=${(ttrStop ?? NOW) > t.start + ttr * 0.75 ? 1 : 0} WHERE id=${id};`);
  });
  writeFileSync(`${WORK}/sla.sql`, slaSql.join('\n') + '\n');

  // CAB decisions for normal and emergency changes past "new".
  await pool('CAB decisions', created.Change.filter((c) => c.kind !== 'RoutineChange' && c.stage !== 'new'), async (c) => {
    await make('ChangeCabDecision', `cab:${c.id}`, { change_id: c.id, meeting_date: itopDate(c.start + (1 + rnd()) * DAY), attendees: c.sm.map(fullName).join(', '), decision: rnd() < 0.88 ? 'approved' : pick(['deferred', 'rejected']), conditions: pick(['Implement in the Saturday window only.', 'Notify the client 48 hours before.', 'Rollback tested in UAT first.', '']), notes: 'Risk assessed as acceptable; communication plan agreed with the client.', recorded_by_id: c.sm[0].id, recorded_at: itopDate(c.start + 2 * DAY) });
  });

  // Problems linked to their incidents, and their known errors.
  await pool('problems', C.PROBLEMS, async ([title, desc, rootCause, workaround, solution, subName]) => {
    const related = created.Incident.filter((x) => x.sub === subName).slice(0, 6);
    const sub = subsByName[subName];
    const start = NOW - (40 + rnd() * 120) * DAY;
    const closed = rnd() < 0.6;
    const pm = teamMembers['Service Management'];
    const pid = await make('Problem', `problem:${title}`, {
      title, description: `<p>${desc}</p>`, org_id: providerId, caller_id: pm[0].id, service_id: sub?.sid, servicesubcategory_id: sub?.id, impact: '2', urgency: '2',
      status: closed ? 'closed' : pick(['assigned', 'assigned', 'resolved']), team_id: teams['Service Management'], agent_id: pick(pm).id,
      start_date: itopDate(start), assignment_date: itopDate(start + DAY), root_cause: rootCause, workaround, solution, ...(closed ? { resolution_date: itopDate(start + 20 * DAY), close_date: itopDate(start + 25 * DAY) } : {}),
      related_incident_list: related.map((x) => ({ id: x.id })).length ? undefined : undefined,
    });
    for (const inc of related) {
      try { await rest({ operation: 'core/update', comment: COMMENT, class: 'Incident', key: inc.id, fields: { parent_problem_id: pid } }); } catch { /* closed tickets may refuse */ }
    }
    await make('KnownError', `ke:${title}`, { name: title.replace(/^Recurring /, ''), org_id: providerId, problem_id: pid, symptom: desc, root_cause: rootCause, workaround, solution, domain: /Wi-Fi|switch|network/i.test(title) ? 'Network' : /server|backup|VSS/i.test(title) ? 'Server' : /ERP|POS|HIS|HL7|Teams/i.test(title) ? 'Application' : 'Desktop' });
  });

  // Knowledge base.
  const cats = {};
  for (const [cat] of C.FAQS) cats[cat] ??= await make('FAQCategory', `faqcat:${cat}`, { name: cat });
  await pool('knowledge articles', C.FAQS, async ([cat, title, summary, body]) => {
    await make('FAQ', `faq:${title}`, { title, summary, description: `<p>${body}</p>`, category_id: cats[cat], key_words: title.toLowerCase().split(/\W+/).filter((w) => w.length > 4).slice(0, 5).join(', ') });
  });

  // Reports: saved queries, each downloadable as CSV, Excel or PDF.
  await pool('reports', C.REPORTS, async ([name, description, oql, fields]) => {
    await make('QueryOQL', `report:${name}`, { name, description, oql, fields });
  });

  console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min, ${calls} calls, ${done.size} records in the manifest`);
}

main().catch((e) => { console.error('seed failed:', e); process.exit(1); });
