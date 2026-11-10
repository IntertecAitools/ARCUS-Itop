import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  ContractInput,
  ServiceLevels,
  SlaInput,
  TargetInput,
} from '@/features/sla/service-levels.types';

const url = (path: string) => `${env.bffUrl}${path}`;
const SL = (path = '') => url(`/admin/service-levels${path}`);

let nextId = 900;
const notFound = () => HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });

export const serviceLevels: ServiceLevels = {
  targets: [
    { id: '1', name: 'P1 incident: own within 15 minutes', requestType: 'incident', priority: '1', metric: 'tto', value: 15, unit: 'minutes', usedBy: 1 },
    { id: '2', name: 'P1 incident: resolve within 4 hours', requestType: 'incident', priority: '1', metric: 'ttr', value: 4, unit: 'hours', usedBy: 1 },
    { id: '3', name: 'P3 incident: resolve within 3 days', requestType: 'incident', priority: '3', metric: 'ttr', value: 72, unit: 'hours', usedBy: 0 },
  ],
  slas: [
    { id: '4', name: 'Gold', description: 'Round-the-clock critical support', providerId: '1', providerName: 'Intertec', targetIds: ['1', '2'], usedBy: 1 },
    { id: '5', name: 'Standard', description: '', providerId: '1', providerName: 'Intertec', targetIds: [], usedBy: 0 },
  ],
  contracts: [
    {
      id: '8',
      name: 'Acme support 2026',
      customerId: '3',
      customerName: 'Acme',
      providerId: '1',
      providerName: 'Intertec',
      status: 'production',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      services: [
        { id: '20', serviceId: '7', serviceName: 'Email', slaId: '4', slaName: 'Gold' },
        { id: '21', serviceId: '9', serviceName: 'VPN', slaId: '', slaName: '' },
      ],
    },
  ],
  services: [
    { id: '7', name: 'Email' },
    { id: '10', name: 'Laptops' },
    { id: '9', name: 'VPN' },
  ],
  organizations: [
    { id: '3', name: 'Acme' },
    { id: '1', name: 'Intertec' },
  ],
};

const data = serviceLevels;
const orgName = (id: string) => data.organizations.find((o) => o.id === id)?.name ?? '';

/** Recomputes the derived fields after a write, as the BFF's next read would. */
function recount() {
  const lines = data.contracts.flatMap((c) => c.services);
  for (const t of data.targets) t.usedBy = data.slas.filter((s) => s.targetIds.includes(t.id)).length;
  for (const s of data.slas) s.usedBy = lines.filter((l) => l.slaId === s.id).length;
  for (const l of lines) l.slaName = data.slas.find((s) => s.id === l.slaId)?.name ?? '';
}

export const serviceLevelHandlers = [
  http.get(SL(), () => HttpResponse.json(data)),

  http.post(SL('/targets'), async ({ request }) => {
    const input = (await request.json()) as TargetInput;
    const id = String((nextId += 1));
    data.targets.push({ id, ...input, usedBy: 0 });
    return HttpResponse.json({ id }, { status: 201 });
  }),
  http.put(SL('/targets/:id'), async ({ params, request }) => {
    const t = data.targets.find((x) => x.id === params['id']);
    if (!t) return notFound();
    Object.assign(t, (await request.json()) as TargetInput);
    return HttpResponse.json({ ok: true });
  }),
  http.delete(SL('/targets/:id'), ({ params }) => {
    data.targets = data.targets.filter((t) => t.id !== params['id']);
    for (const s of data.slas) s.targetIds = s.targetIds.filter((id) => id !== params['id']);
    recount();
    return HttpResponse.json({ ok: true });
  }),

  http.post(SL('/slas'), async ({ request }) => {
    const input = (await request.json()) as SlaInput;
    const id = String((nextId += 1));
    data.slas.push({ id, ...input, providerName: orgName(input.providerId), usedBy: 0 });
    recount();
    return HttpResponse.json({ id }, { status: 201 });
  }),
  http.put(SL('/slas/:id'), async ({ params, request }) => {
    const s = data.slas.find((x) => x.id === params['id']);
    if (!s) return notFound();
    const input = (await request.json()) as SlaInput;
    Object.assign(s, input, { providerName: orgName(input.providerId) });
    recount();
    return HttpResponse.json({ ok: true });
  }),
  http.delete(SL('/slas/:id'), ({ params }) => {
    const lines = data.contracts.flatMap((c) => c.services).filter((l) => l.slaId === params['id']);
    for (const l of lines) l.slaId = '';
    data.slas = data.slas.filter((s) => s.id !== params['id']);
    recount();
    return HttpResponse.json({ detached: lines.length });
  }),

  http.post(SL('/contracts'), async ({ request }) => {
    const input = (await request.json()) as ContractInput;
    const id = String((nextId += 1));
    data.contracts.push({
      id,
      ...input,
      customerName: orgName(input.customerId),
      providerName: orgName(input.providerId),
      services: [],
    });
    return HttpResponse.json({ id }, { status: 201 });
  }),
  http.put(SL('/contracts/:id'), async ({ params, request }) => {
    const c = data.contracts.find((x) => x.id === params['id']);
    if (!c) return notFound();
    const input = (await request.json()) as ContractInput;
    Object.assign(c, input, { customerName: orgName(input.customerId), providerName: orgName(input.providerId) });
    return HttpResponse.json({ ok: true });
  }),
  http.delete(SL('/contracts/:id'), ({ params }) => {
    data.contracts = data.contracts.filter((c) => c.id !== params['id']);
    recount();
    return HttpResponse.json({ ok: true });
  }),

  http.post(SL('/contracts/:id/services'), async ({ params, request }) => {
    const c = data.contracts.find((x) => x.id === params['id']);
    if (!c) return notFound();
    const input = (await request.json()) as { serviceId: string; slaId: string };
    if (c.services.some((s) => s.serviceId === input.serviceId)) {
      return HttpResponse.json(
        { error: { code: 'bad_request', message: 'That service is already on this contract.' } },
        { status: 400 },
      );
    }
    const id = String((nextId += 1));
    const serviceName = data.services.find((s) => s.id === input.serviceId)?.name ?? '';
    c.services.push({ id, serviceId: input.serviceId, serviceName, slaId: input.slaId, slaName: '' });
    c.services.sort((a, b) => a.serviceName.localeCompare(b.serviceName));
    recount();
    return HttpResponse.json({ id }, { status: 201 });
  }),
  http.put(SL('/contract-services/:id'), async ({ params, request }) => {
    const line = data.contracts.flatMap((c) => c.services).find((l) => l.id === params['id']);
    if (!line) return notFound();
    line.slaId = ((await request.json()) as { slaId: string }).slaId;
    recount();
    return HttpResponse.json({ ok: true });
  }),
  http.delete(SL('/contract-services/:id'), ({ params }) => {
    for (const c of data.contracts) c.services = c.services.filter((l) => l.id !== params['id']);
    recount();
    return HttpResponse.json({ ok: true });
  }),
];
