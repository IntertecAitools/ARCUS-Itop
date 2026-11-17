import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { IssueLicenceInput, IssueLicenceResult, LicencesOverview, RegisterRow } from '@/features/licensing/types';
import { readStored, writeStored } from '../storage';

const url = (path: string) => `${env.bffUrl}${path}`;

/** The licence register as the platform operator sees it: one current, one ending soon, one revoked. */
const SEED: RegisterRow[] = [
  row('ARC-2026-000003', 'Northwind', 'tenant:northwind', 'ENT', '2026-12-01', '2029-11-30'),
  row('ARC-2026-000002', 'Contoso', 'tenant:contoso', 'PRO', '2025-12-10', '2026-12-09'),
  { ...row('ARC-2026-000001', 'Fabrikam', 'tenant:fabrikam', 'ESS', '2026-01-01', '2026-12-31'), status: 'revoked', revokedAt: '2026-10-01T10:00:00Z', revokedBy: 'operator', revokeReason: 'contract ended' },
];

function row(licenceId: string, customer: string, binding: string, edition: RegisterRow['edition'], validFrom: string, expiresAt: string): RegisterRow {
  return {
    licenceId,
    customer,
    orderRef: 'SO-1',
    binding,
    edition,
    licenceType: 'subscription',
    validFrom,
    expiresAt,
    issuedBy: 'operator',
    issuedAt: `${validFrom}T09:00:00Z`,
    reason: 'new order',
    replaces: null,
    replacedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    status: 'current',
  };
}

const rows = () => readStored<RegisterRow[]>('licence.register', SEED);
const save = (r: RegisterRow[]) => writeStored('licence.register', r);
const nextId = (r: RegisterRow[]) => `ARC-2026-${String(r.length + 1).padStart(6, '0')}`;

function overview(customer: string | null): LicencesOverview {
  const all = rows().filter((r) => !customer || r.customer.toLowerCase().includes(customer.toLowerCase()));
  const current = all.filter((r) => r.status === 'current' && r.expiresAt);
  return {
    canIssue: true,
    licences: all,
    renewals: {
      within30: current.filter((r) => r.expiresAt! <= '2026-12-17'),
      within60: current.filter((r) => r.expiresAt! > '2026-12-17' && r.expiresAt! <= '2027-01-16'),
      within90: current.filter((r) => r.expiresAt! > '2027-01-16' && r.expiresAt! <= '2027-02-15'),
    },
  };
}

const text = (id: string) => `-----BEGIN ARCUS LICENCE-----\nbW9jaw\n.\nbW9jaw\n-----END ARCUS LICENCE-----\n# ${id}`;

export const licenceDeskHandlers = [
  http.get(url('/platform/licences'), ({ request }) => HttpResponse.json(overview(new URL(request.url).searchParams.get('customer')))),
  http.post(url('/platform/licences'), async ({ request }) => {
    const input = (await request.json()) as IssueLicenceInput;
    const all = rows();
    const issued: RegisterRow = {
      ...row(nextId(all), input.customer, input.binding, input.edition, input.validFrom ?? '2026-12-01', '2027-11-30'),
      orderRef: input.orderRef,
      licenceType: input.type,
    };
    save([issued, ...all]);
    const result: IssueLicenceResult = { licence: issued, text: text(issued.licenceId), installed: input.deployment === 'saas', tenantCreated: Boolean(input.newTenant) };
    return HttpResponse.json(result, { status: 201 });
  }),
  http.post(url('/platform/licences/:id/reissue'), async ({ params, request }) => {
    const body = (await request.json()) as { reason: string; edition?: RegisterRow['edition'] };
    const all = rows();
    const old = all.find((r) => r.licenceId === params['id']);
    if (!old) return HttpResponse.json({ error: { code: 'not_found', message: 'No such licence.' } }, { status: 404 });
    const issued: RegisterRow = { ...old, licenceId: nextId(all), edition: body.edition ?? old.edition, reason: body.reason, replaces: old.licenceId };
    save([issued, ...all.map((r) => (r.licenceId === old.licenceId ? { ...r, status: 'replaced' as const, replacedBy: issued.licenceId } : r))]);
    return HttpResponse.json({ licence: issued, text: text(issued.licenceId), installed: true, tenantCreated: false } satisfies IssueLicenceResult, { status: 201 });
  }),
  http.post(url('/platform/licences/:id/revoke'), async ({ params, request }) => {
    const { reason } = (await request.json()) as { reason: string };
    const all = rows().map((r) =>
      r.licenceId === params['id'] ? { ...r, status: 'revoked' as const, revokedAt: new Date().toISOString(), revokedBy: 'operator', revokeReason: reason } : r,
    );
    save(all);
    return HttpResponse.json(all.find((r) => r.licenceId === params['id']));
  }),
];
