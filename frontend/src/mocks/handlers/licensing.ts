import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { Edition, Feature, LicenceBanner, LicenceCheckResult, LicenceStatus, LicenceSummary } from '@/features/licensing/types';
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
    nonProduction: s === 'nonprod',
    maintenanceLapsed: false,
    banners,
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
  ciLimit: 25000,
  aiActionsPerMonth: 40000,
  storageGb: 500,
  addons: [],
  binding: 'tenant:northwind',
};

function check(text: string): LicenceCheckResult {
  if (!text.includes('BEGIN ARCUS LICENCE')) {
    return { ok: false, message: 'This is not a licence file: expected BEGIN … LICENCE, the content, a dot, the signature and END.', changes: [], older: false };
  }
  return { ok: true, summary: SUMMARY, changes: ['Agents 60 → 80', 'End date 2027-11-30 → 2029-11-30'], older: false };
}

export const licensingHandlers = [
  http.get(url('/licence/status'), () => HttpResponse.json(status())),
  http.post(url('/licence/check'), async ({ request }) => {
    const { text } = (await request.json()) as { text: string };
    return HttpResponse.json(check(text));
  }),
  http.put(url('/licence'), async ({ request }) => {
    const { text } = (await request.json()) as { text: string };
    const result = check(text);
    if (!result.ok) return HttpResponse.json({ error: { code: 'bad_request', message: result.message } }, { status: 400 });
    writeStored('licence', 'enterprise');
    return HttpResponse.json(result);
  }),
];
