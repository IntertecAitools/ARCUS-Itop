import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { Incident } from '@/features/incidents';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock incidents.
 *
 * Empty by default, matching an iTop instance with no tickets — the state the
 * empty views are designed against. Flip SEEDED for a populated queue to style
 * or demo against.
 */
const SEEDED = false;

const seeded: Incident[] = [
  {
    id: '1042',
    ref: 'I-001042',
    summary: 'VPN connection unavailable',
    status: 'open',
    priority: 'critical',
    assignee: { id: '1', name: 'Vasanth' },
    createdAt: '2026-10-06 10:42:00',
  },
  {
    id: '1041',
    ref: 'I-001041',
    summary: 'Email service intermittent',
    status: 'in_progress',
    priority: 'high',
    assignee: { id: '2', name: 'Ravi' },
    createdAt: '2026-10-06 09:15:00',
  },
  {
    id: '1040',
    ref: 'I-001040',
    summary: 'Laptop not booting',
    status: 'resolved',
    priority: 'medium',
    createdAt: '2026-10-05 16:21:00',
  },
];

export const incidentHandlers = [
  http.get(url('/incidents'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit')) || 25;
    const page = Number(params.get('page')) || 1;

    // Filtering is applied for real so the mock exercises the same code paths
    // the live BFF would — a mock that ignores filters hides bugs in them.
    const status = params.get('status')?.split(',').filter(Boolean);
    const priority = params.get('priority')?.split(',').filter(Boolean);
    const q = params.get('q')?.toLowerCase();

    let items = SEEDED ? seeded : [];
    if (status?.length) items = items.filter((i) => status.includes(i.status));
    if (priority?.length) items = items.filter((i) => priority.includes(i.priority));
    if (q) {
      items = items.filter(
        (i) => i.ref.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q),
      );
    }

    const total = items.length;
    return HttpResponse.json({
      items: items.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
    });
  }),

  http.get(url('/incidents/:id'), ({ params }) => {
    const incident = seeded.find((i) => i.id === params.id);
    if (!SEEDED || !incident) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: `Incident ${params.id} was not found.` } },
        { status: 404 },
      );
    }
    return HttpResponse.json({
      ...incident,
      description: 'Users report the VPN client fails to establish a tunnel.',
      sla: { ttoBreached: false, ttrBreached: false },
    });
  }),
];
