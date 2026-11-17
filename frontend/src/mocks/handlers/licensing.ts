import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { Edition, Feature, LicenceBanner, LicenceCheckResult, LicenceDetail, LicenceEventDto, LicenceStatus, LicenceSummary, UsageRow } from '@/features/licensing/types';
import { readStored, writeStored } from '../storage';
import { currentMockUser } from './auth';

const url = (path: string) => `${env.bffUrl}${path}`;

const ESS: Feature[] = ['service_desk', 'service_levels', 'knowledge', 'cmdb', 'import_export'];
const PRO: Feature[] = [...ESS, 'problem', 'change', 'approvals_forms', 'analytics', 'ai', 'sso'];
const ALL: Feature[] = [...PRO, 'multi_org', 'audit_sync'];
/** The draft matrix, as the BFF reports it. */
const FEATURE_EDITIONS = Object.fromEntries(ALL.map((f) => [f, ESS.includes(f) ? 'ESS' : PRO.includes(f) ? 'PRO' : 'ENT'])) as Record<Feature, Edition>;
const EDITION_NAMES: Record<Edition, string> = { ESS: 'Essentials', PRO: 'Professional', ENT: 'Enterprise' };

/**
 * Licence scenarios a journey picks before the app loads
 * (`sessionStorage['arcus.mock.licence'] = '"nonprod"'`). The default is a
 * valid Enterprise licence, so every module shows, as with licensing off.
 */
type Scenario = 'enterprise' | 'professional' | 'essentials' | 'nonprod' | 'expiring' | 'grace' | 'read_only';
const scenario = () => readStored<Scenario>('licence', 'enterprise');

function status(): LicenceStatus {
  const user = currentMockUser();
  const staff = user.kind === 'staff';
  const s = scenario();
  const banners: LicenceBanner[] = [];
  const edition: Edition = s === 'essentials' ? 'ESS' : s === 'professional' ? 'PRO' : 'ENT';
  if (s === 'nonprod') banners.push({ kind: 'nonprod', tone: 'info', message: 'Non-production licence: not for live use.' });
  if (staff && s === 'expiring' && user.isAdmin) {
    banners.push({ kind: 'expiring_soon', tone: 'info', message: 'The licence ends on 2027-11-30 (12 days left). Renew it to keep working without interruption.' });
  }
  if (staff && s === 'grace') {
    banners.push({ kind: 'grace', tone: 'warning', message: 'The licence ended on 2027-11-30. 21 days of grace left before the service becomes read-only.' });
  }
  if (staff && s === 'read_only') {
    banners.push({ kind: 'read_only', tone: 'danger', message: 'The licence has ended. Agents can read but not change anything; data export still works. An administrator can install a new licence.' });
  }
  return {
    mode: 'enforce',
    state: s === 'expiring' ? 'expiring_soon' : s === 'grace' ? 'grace' : s === 'read_only' ? 'read_only' : 'valid',
    readOnly: s === 'read_only',
    edition,
    editionName: EDITION_NAMES[edition],
    features: edition === 'ESS' ? ESS : edition === 'PRO' ? PRO : ALL,
    featureEditions: FEATURE_EDITIONS,
    licenceType: s === 'nonprod' ? 'nonprod' : 'subscription',
    expiresAt: '2027-11-30',
    daysLeft: s === 'expiring' ? 12 : s === 'grace' ? -9 : s === 'read_only' ? -40 : 380,
    graceDaysLeft: s === 'grace' ? 21 : null,
    reactivationDaysLeft: null,
    nonProduction: s === 'nonprod',
    maintenanceLapsed: false,
    banners,
    // The mock's administrator also runs the platform: the Licences page shows.
    operator: staff && user.isAdmin,
  };
}

const SUMMARY: LicenceSummary = {
  licenceId: 'ARC-2026-000124',
  customer: 'Northwind',
  orderRef: 'SO-45679',
  edition: 'ENT',
  editionName: 'Enterprise',
  licenceType: 'subscription',
  deployment: 'saas',
  termYears: 3,
  issuedAt: '2026-11-16T09:00:00Z',
  validFrom: '2026-12-01',
  expiresAt: '2029-11-30',
  maintenanceUntil: null,
  graceDays: 30,
  namedSeats: 80,
  concurrentSeats: 0,
  ciLimit: 50000,
  aiActionsPerMonth: 40000,
  storageGb: 500,
  addons: ['premium_support'],
  binding: 'tenant:northwind',
};

function check(text: string): LicenceCheckResult {
  if (!text.includes('BEGIN ARCUS LICENCE')) {
    return { ok: false, message: 'This is not a licence file: expected BEGIN … LICENCE, the content, a dot, the signature and END.', changes: [], older: false };
  }
  return { ok: true, summary: SUMMARY, changes: ['Agents 60 → 80', 'End date 2027-11-30 → 2029-11-30'], older: false };
}

const USAGE: UsageRow[] = [
  { metric: 'agents', label: 'Agents', used: 52, limit: 60, percent: 87, level: 'warning' },
  { metric: 'sessions', label: 'Agent sessions', used: 14, limit: 60, percent: 23, level: 'ok' },
  { metric: 'cis', label: 'Configuration items', used: 3120, limit: 10000, percent: 31, level: 'ok' },
  { metric: 'ai_actions', label: 'AI actions this month', used: 410, limit: 18000, percent: 2, level: 'ok' },
  { metric: 'storage', label: 'Storage (GB)', used: 18.4, limit: null, percent: null, level: 'ok' },
];

const EULA_TEXT = 'PLACEHOLDER — this is not the agreement.\n\nIntertec’s legal team will provide the end-user licence agreement.';

/** The licence page of a deployed installation whose administrator may install keys. */
function detail(): LicenceDetail {
  const accepted = readStored<{ by: string; at: string } | null>('licence.eula', null);
  const history = readStored<LicenceEventDto[]>('licence.history', [
    { id: 2, at: '2026-11-16T09:00:00Z', type: 'state_changed', label: 'State changed', actor: null, detail: 'trial → valid' },
    { id: 1, at: '2026-11-16T08:59:00Z', type: 'key_uploaded', label: 'Key installed', actor: 'admin', detail: 'ARC-2026-000123: Edition PRO, 60 agents, until 2029-11-30' },
  ]);
  return {
    status: status(),
    summary: { ...SUMMARY, licenceId: 'ARC-2026-000123', customer: 'Example Co', orderRef: 'SO-45678', edition: 'PRO', editionName: 'Professional', deployment: 'deployed', namedSeats: 60, ciLimit: 5000, aiActionsPerMonth: 18000, storageGb: null, binding: 'install:7f3c2a10-8f7e-4d1b-9c39-2b7e5f0a1c22' },
    usage: USAGE,
    history,
    canInstall: true,
    deployment: 'deployed',
    installation: { id: '7f3c2a10-8f7e-4d1b-9c39-2b7e5f0a1c22', reportKeyId: 'k3y-1d', reportPublicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n' },
    activation: { online: false, clusterId: null, last: readStored<{ at: string; result: string } | null>('licence.activation', null) },
    eula: { version: 'placeholder-2026-11', text: EULA_TEXT, required: !accepted, acceptedBy: accepted?.by ?? null, acceptedAt: accepted?.at ?? null },
  };
}

function note(type: string, label: string, text: string) {
  const d = detail();
  writeStored('licence.history', [{ id: d.history.length + 1, at: new Date().toISOString(), type, label, actor: 'admin', detail: text }, ...d.history]);
}

export const licensingHandlers = [
  http.post(url('/licence/activation-request'), async ({ request }) => {
    const { orderRef } = (await request.json()) as { orderRef: string };
    writeStored('licence.activation', { at: new Date().toISOString(), result: 'Activation request created as a file, to send to Intertec.' });
    return HttpResponse.json({
      mode: 'offline',
      installed: false,
      message: 'Send this file to Intertec; upload the licence file that comes back.',
      request: { kind: 'activation_request', alg: 'Ed25519', key_id: 'k3y-1d', payload: { product: 'arcus', installation_id: '7f3c2a10-8f7e-4d1b-9c39-2b7e5f0a1c22', order_ref: orderRef }, signature: 'mock' },
    });
  }),
  http.get(url('/licence'), () => HttpResponse.json(detail())),
  http.post(url('/licence/eula'), () => {
    writeStored('licence.eula', { by: 'admin', at: new Date().toISOString() });
    note('eula_accepted', 'Terms accepted', 'Accepted the terms of service (placeholder-2026-11).');
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(url('/licence/usage-report'), ({ request }) => {
    const q = new URL(request.url).searchParams;
    return HttpResponse.json(
      { kind: 'usage_report', alg: 'Ed25519', key_id: 'k3y-1d', payload: { product: 'arcus', licence_id: 'ARC-2026-000123', from: q.get('from'), to: q.get('to'), days: [] }, signature: 'mock' },
      { headers: { 'Content-Disposition': 'attachment; filename="arcus-usage.json"' } },
    );
  }),
  http.get(url('/licence/status'), () => HttpResponse.json(status())),
  http.post(url('/licence/check'), async ({ request }) => {
    const { text } = (await request.json()) as { text: string };
    return HttpResponse.json(check(text));
  }),
  http.put(url('/licence'), async ({ request }) => {
    const body = (await request.json()) as { text: string; acceptEula?: boolean };
    const result = check(body.text);
    if (!result.ok) return HttpResponse.json({ error: { code: 'bad_request', message: result.message } }, { status: 400 });
    if (detail().eula.required && !body.acceptEula) {
      return HttpResponse.json({ error: { code: 'bad_request', message: 'Accept the end-user licence agreement to install the licence.' } }, { status: 400 });
    }
    if (body.acceptEula) writeStored('licence.eula', { by: 'admin', at: new Date().toISOString() });
    note('key_uploaded', 'Key installed', `${result.summary!.licenceId}: ${result.changes.join('; ')}`);
    writeStored('licence', 'enterprise');
    return HttpResponse.json(result);
  }),
];
