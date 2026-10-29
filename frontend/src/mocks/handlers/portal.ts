import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { CatalogService, NewRequest, PortalTicket, PortalTicketDetail } from '@/features/portal/types';
import { readStored, writeStored } from '../storage';
import { currentMockUser } from './auth';
import { mockDescribe, mockFormFor } from './request-forms';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * A small, believable self-service portal: two requests, a catalogue, a few
 * articles. Enough to build and style every portal screen without the BFF;
 * the scoping rules themselves live in the BFF and are tested there.
 */
const catalog: CatalogService[] = [
  {
    id: 1,
    name: 'Network access',
    description: 'Wi-Fi, VPN and remote access.',
    family: 'IT services',
    subcategories: [
      { id: 11, name: 'VPN', description: '' },
      { id: 12, name: 'Wi-Fi', description: '' },
    ],
  },
  { id: 2, name: 'Hardware', description: 'Laptops, screens and peripherals.', family: 'IT services', subcategories: [] },
];

const seeded: PortalTicket[] = [
  {
    id: 101,
    ref: 'R-000101',
    kind: 'request',
    title: 'Laptop will not connect to the VPN',
    status: 'in_progress',
    priority: 'medium',
    closed: false,
    createdAt: '2026-10-15T09:12:00Z',
    updatedAt: '2026-10-16T14:03:00Z',
    service: 'Network access',
    subcategory: 'VPN',
    targetDate: inDays(2),
    targetMissed: false,
  },
  {
    id: 102,
    ref: 'R-000102',
    kind: 'request',
    title: 'New monitor for the finance desk',
    status: 'resolved',
    priority: 'low',
    closed: false,
    createdAt: '2026-10-10T11:40:00Z',
    updatedAt: '2026-10-14T10:00:00Z',
    service: 'Hardware',
    subcategory: 'Peripherals',
    targetDate: '2026-10-15T17:00:00Z',
    targetMissed: false,
  },
];

const seededDetail = (t: PortalTicket): PortalTicketDetail => ({
  ...t,
  description: 'Describe the problem here.',
  solution: t.status === 'resolved' ? 'A 27" monitor was delivered and installed.' : '',
  caller: 'Mock Administrator',
  agent: 'Sam Agent',
  team: 'Service desk',
  resolvedAt: t.status === 'resolved' ? t.updatedAt : '',
  closedAt: '',
  urgency: '3',
  impact: '3',
  satisfaction: '',
  userComment: '',
  log: [{ date: t.updatedAt, author: 'Sam Agent', message: 'We are looking into it.' }],
  actions: t.status === 'resolved' ? ['close', 'reopen'] : t.closed ? [] : ['cancel'],
});

/**
 * Mutable, and kept across reloads, so raising a request and commenting on it
 * behave like the real thing: the new request is in the list afterwards.
 */
let tickets: PortalTicketDetail[] = readStored('portal', seeded.map(seededDetail));
const save = () => writeStored('portal', tickets);

const summary = ({ id, ref, kind, title, status, priority, closed, createdAt, updatedAt, service, subcategory, targetDate, targetMissed }: PortalTicketDetail): PortalTicket =>
  ({ id, ref, kind, title, status, priority, closed, createdAt, updatedAt, service, subcategory, targetDate: targetDate ?? '', targetMissed: targetMissed ?? false });

const notFound = () =>
  HttpResponse.json({ error: { code: 'not_found', message: 'No such request.' } }, { status: 404 });

const PRIORITY: Record<string, PortalTicket['priority']> = { '1': 'critical', '2': 'high', '3': 'medium', '4': 'low' };

export const portalHandlers = [
  http.get(url('/portal/requests'), ({ request }) => {
    const closed = new URL(request.url).searchParams.get('state') === 'closed';
    const items = tickets.filter((t) => t.closed === closed).map(summary);
    return HttpResponse.json({ items, total: items.length, page: 1, pages: 1 });
  }),
  http.get(url('/portal/requests/:id'), ({ params }) => {
    const ticket = tickets.find((t) => t.id === Number(params.id));
    return ticket ? HttpResponse.json(ticket) : notFound();
  }),
  http.post(url('/portal/requests'), async ({ request }) => {
    const input = (await request.json()) as NewRequest;
    const service = catalog.find((s) => s.id === input.serviceId);
    const id = Math.max(100, ...tickets.map((t) => t.id)) + 1;
    const now = new Date().toISOString();
    const created: PortalTicketDetail = {
      id,
      ref: `R-000${id}`,
      kind: 'request',
      title: input.title,
      status: 'new',
      priority: PRIORITY[input.urgency ?? '4'] ?? 'low',
      closed: false,
      createdAt: now,
      updatedAt: now,
      service: service?.name ?? '',
      subcategory: service?.subcategories.find((sc) => sc.id === input.subcategoryId)?.name ?? '',
      // Raised against a service: the mock SLA gives it three days.
      targetDate: service ? inDays(3) : '',
      targetMissed: false,
      description: mockDescribe(input.description, mockFormFor(input.serviceId, input.subcategoryId), input.answers),
      solution: '',
      caller: currentMockUser().name,
      agent: '',
      team: '',
      resolvedAt: '',
      closedAt: '',
      urgency: input.urgency ?? '4',
      impact: '3',
      satisfaction: '',
      userComment: '',
      log: [],
      actions: ['cancel'],
    };
    tickets = [created, ...tickets];
    save();
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post(url('/portal/requests/:id/comments'), async ({ params, request }) => {
    const ticket = tickets.find((t) => t.id === Number(params.id));
    if (!ticket) return notFound();
    const { message } = (await request.json()) as { message: string };
    ticket.log = [{ date: new Date().toISOString(), author: currentMockUser().name, message }, ...ticket.log];
    save();
    return HttpResponse.json(ticket);
  }),
  http.post(url('/portal/requests/:id/close'), ({ params }) => {
    const ticket = tickets.find((t) => t.id === Number(params.id));
    return ticket ? HttpResponse.json(ticket) : notFound();
  }),
  // Cancel: resolved with the reason, then closed, as the BFF does.
  http.post(url('/portal/requests/:id/cancel'), async ({ params, request }) => {
    const ticket = tickets.find((t) => t.id === Number(params.id));
    if (!ticket) return notFound();
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim() || reason.trim().length < 3) {
      return HttpResponse.json({ error: { code: 'bad_request', message: 'Say why the ticket is cancelled.' } }, { status: 400 });
    }
    const now = new Date().toISOString();
    Object.assign(ticket, {
      status: 'closed',
      closed: true,
      solution: `Cancelled by ${currentMockUser().name} (requester): ${reason.trim()}`,
      resolvedAt: now,
      closedAt: now,
      updatedAt: now,
      actions: [],
    });
    save();
    return HttpResponse.json(ticket);
  }),
  http.post(url('/portal/requests/:id/reopen'), ({ params }) => {
    const ticket = tickets.find((t) => t.id === Number(params.id));
    return ticket ? HttpResponse.json(ticket) : notFound();
  }),
  http.get(url('/portal/requests/:id/attachments'), ({ params }) =>
    HttpResponse.json({ items: [], total: 0, item: { class: 'UserRequest', id: String(params.id) } }),
  ),
  http.get(url('/portal/catalog'), () => HttpResponse.json({ services: catalog })),
  http.get(url('/portal/faqs'), () =>
    HttpResponse.json({
      items: [
        { id: 1, title: 'How do I reset my password?', summary: 'Use Change password in My profile.', category: 'Accounts' },
        { id: 2, title: 'How do I connect to the VPN?', summary: 'Install the client, then sign in.', category: 'Network' },
      ],
    }),
  ),
  http.get(url('/portal/faqs/:id'), ({ params }) =>
    HttpResponse.json({
      id: Number(params.id),
      title: 'How do I connect to the VPN?',
      summary: 'Install the client, then sign in.',
      description: 'Download the VPN client from the software centre, then sign in with your usual account.',
      category: 'Network',
    }),
  ),
  http.post(url('/portal/faqs/:id/feedback'), async ({ request }) => {
    const body = (await request.json()) as { helpful: boolean };
    return HttpResponse.json({ yes: body.helpful ? 1 : 0, no: body.helpful ? 0 : 1, score: body.helpful ? 100 : 0 });
  }),
  http.get(url('/portal/profile'), () =>
    HttpResponse.json({
      firstName: 'Mock',
      lastName: 'Administrator',
      email: 'admin@example.test',
      phone: '',
      mobilePhone: '',
      function: 'IT',
      organization: 'Demo',
    }),
  ),
  http.patch(url('/portal/profile'), async ({ request }) => {
    const body = (await request.json()) as { phone?: string; mobilePhone?: string };
    return HttpResponse.json({
      firstName: 'Mock',
      lastName: 'Administrator',
      email: 'admin@example.test',
      phone: body.phone ?? '',
      mobilePhone: body.mobilePhone ?? '',
      function: 'IT',
      organization: 'Demo',
    });
  }),
];
