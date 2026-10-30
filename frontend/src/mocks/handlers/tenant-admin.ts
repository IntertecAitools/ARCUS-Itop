import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { EmailDomain, OrgRow, TeamRow, TenantDetail } from '@/features/tenant-admin/types';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * One customer, "Northwind", as its own administrator sees it: tenancy is on
 * and this administrator is held to it (operator: false). Branding starts
 * empty, so the app wears its built-in look until a colour is saved.
 */
const orgs: OrgRow[] = [
  { id: 3, name: 'Northwind HQ', code: 'NW', status: 'active', parentId: 0, parentName: '' },
  { id: 4, name: 'Northwind Retail', code: 'NWR', status: 'active', parentId: 3, parentName: 'Northwind HQ' },
];
const teams: TeamRow[] = [
  {
    id: 41,
    name: 'Northwind service desk',
    email: 'desk@northwind.example',
    status: 'active',
    orgId: 3,
    orgName: 'Northwind HQ',
    members: [{ id: 7, name: 'Ada Byron' }],
  },
];
const people = [
  { id: 7, name: 'Ada Byron', email: 'ada@northwind.example' },
  { id: 8, name: 'Grace Hopper', email: 'grace@northwind.example' },
  { id: 9, name: 'Alan Turing', email: 'alan@northwind.example' },
];
let emailDomains: EmailDomain[] = [{ domain: 'northwind.example', orgId: 3 }];
const hostnames = ['northwind.servicedesk.example'];
let branding: { productName?: string; accentColor?: string; logo?: string } = {};

function detail(): TenantDetail {
  return {
    id: 'northwind',
    name: 'Northwind',
    status: 'active',
    hostnames,
    emailDomains,
    branding: {
      ...(branding.productName ? { productName: branding.productName } : {}),
      ...(branding.accentColor ? { accentColor: branding.accentColor } : {}),
    },
    orgs: orgs.map((o) => ({ id: o.id, name: o.name })),
  };
}

const notFound = () => HttpResponse.json({ error: { code: 'not_found', message: 'No customer here.' } }, { status: 404 });
const badRequest = (message: string) => HttpResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });

export const tenantAdminHandlers = [
  http.get(url('/branding'), () =>
    HttpResponse.json({
      branding:
        branding.accentColor || branding.productName ? { tenantId: 'northwind', tenantName: 'Northwind', ...detail().branding } : null,
    }),
  ),
  http.post(url('/auth/register'), () =>
    HttpResponse.json(
      { ok: true, message: 'Check your email: we have sent a link to set your password. It works once and expires soon.' },
      { status: 202 },
    ),
  ),
  http.put(url('/auth/language'), async ({ request }) => HttpResponse.json(await request.json())),
  http.get(url('/admin/tenants'), () =>
    HttpResponse.json({ operator: false, tenants: [{ id: 'northwind', name: 'Northwind', status: 'active' }] }),
  ),
  http.get(url('/admin/tenants/:id'), ({ params }) => (params['id'] === 'northwind' ? HttpResponse.json(detail()) : notFound())),
  http.get(url('/admin/tenants/:id/orgs'), () => HttpResponse.json({ items: orgs })),
  http.post(url('/admin/tenants/:id/orgs'), async ({ request }) => {
    const body = (await request.json()) as { name: string; code?: string; parentId?: number };
    const parent = orgs.find((o) => o.id === body.parentId);
    const row: OrgRow = {
      id: 100 + orgs.length,
      name: body.name,
      code: body.code ?? '',
      status: 'active',
      parentId: parent?.id ?? 0,
      parentName: parent?.name ?? '',
    };
    orgs.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.patch(url('/admin/tenants/:id/orgs/:orgId'), async ({ params, request }) => {
    const row = orgs.find((o) => o.id === Number(params['orgId']));
    if (!row) return notFound();
    Object.assign(row, await request.json());
    return HttpResponse.json(row);
  }),
  http.get(url('/admin/tenants/:id/teams'), () => HttpResponse.json({ items: teams })),
  http.post(url('/admin/tenants/:id/teams'), async ({ request }) => {
    const body = (await request.json()) as { name: string; orgId: number; email?: string };
    const row: TeamRow = {
      id: 500 + teams.length,
      name: body.name,
      email: body.email ?? '',
      status: 'active',
      orgId: body.orgId,
      orgName: orgs.find((o) => o.id === body.orgId)?.name ?? '',
      members: [],
    };
    teams.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.patch(url('/admin/tenants/:id/teams/:teamId'), async ({ params, request }) => {
    const team = teams.find((x) => x.id === Number(params['teamId']));
    if (!team) return notFound();
    const body = (await request.json()) as { name?: string; memberIds?: number[] };
    if (body.memberIds) {
      team.members = body.memberIds.map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? `#${id}` }));
    }
    if (body.name) team.name = body.name;
    return HttpResponse.json(team);
  }),
  http.get(url('/admin/tenants/:id/people'), ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();
    return HttpResponse.json({ items: people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q)) });
  }),
  http.put(url('/admin/tenants/:id/branding'), async ({ request }) => {
    const body = (await request.json()) as typeof branding;
    if (body.accentColor && !/^#[0-9a-f]{6}$/i.test(body.accentColor)) {
      return badRequest('The brand colour must be a hex colour such as #6d4aff.');
    }
    branding = {
      productName: body.productName ?? branding.productName,
      accentColor: body.accentColor ?? branding.accentColor,
      logo: body.logo ?? branding.logo,
    };
    return HttpResponse.json(detail());
  }),
  http.put(url('/admin/tenants/:id/email-domains'), async ({ request }) => {
    const body = (await request.json()) as { emailDomains: EmailDomain[] };
    const bad = body.emailDomains.find((d) => ['gmail.com', 'outlook.com', 'hotmail.com'].includes(d.domain));
    if (bad) return badRequest(`${bad.domain} is a public mail provider, not an organisation's domain.`);
    emailDomains = body.emailDomains;
    return HttpResponse.json(detail());
  }),
  http.put(url('/admin/tenants/:id/hostnames'), () =>
    HttpResponse.json({ error: { code: 'forbidden', message: 'Host names are set by the platform operator.' } }, { status: 403 }),
  ),
];
