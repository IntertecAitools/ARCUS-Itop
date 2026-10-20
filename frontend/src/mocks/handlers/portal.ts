import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * A small, believable self-service portal: two requests, a catalogue, a few
 * articles. Enough to build and style every portal screen without the BFF;
 * the scoping rules themselves live in the BFF and are tested there.
 */
const tickets = [
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
  },
];

const detail = (id: number) => {
  const t = tickets.find((x) => x.id === id) ?? tickets[0]!;
  return {
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
    actions: t.status === 'resolved' ? ['close', 'reopen'] : [],
  };
};

export const portalHandlers = [
  http.get(url('/portal/requests'), ({ request }) => {
    const closed = new URL(request.url).searchParams.get('state') === 'closed';
    const items = tickets.filter((t) => t.closed === closed);
    return HttpResponse.json({ items, total: items.length, page: 1, pages: 1 });
  }),
  http.get(url('/portal/requests/:id'), ({ params }) => HttpResponse.json(detail(Number(params.id)))),
  http.post(url('/portal/requests'), () => HttpResponse.json(detail(101), { status: 201 })),
  http.post(url('/portal/requests/:id/comments'), ({ params }) => HttpResponse.json(detail(Number(params.id)))),
  http.post(url('/portal/requests/:id/close'), ({ params }) => HttpResponse.json(detail(Number(params.id)))),
  http.post(url('/portal/requests/:id/reopen'), ({ params }) => HttpResponse.json(detail(Number(params.id)))),
  http.get(url('/portal/requests/:id/attachments'), ({ params }) =>
    HttpResponse.json({ items: [], total: 0, item: { class: 'UserRequest', id: String(params.id) } }),
  ),
  http.get(url('/portal/catalog'), () =>
    HttpResponse.json({
      services: [
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
      ],
    }),
  ),
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
