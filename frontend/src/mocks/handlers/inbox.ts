import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';

const url = (path: string) => `${env.bffUrl}${path}`;

/** A few notifications, so the bell can be worked on without the BFF. */
let items = [
  {
    id: 3,
    title: 'INC-1042',
    message: 'Ticket has been assigned to you',
    date: new Date(Date.now() - 5 * 60_000).toISOString(),
    priority: 'high',
    read: false,
    record: { type: 'Incident', id: 1042 },
  },
  {
    id: 2,
    title: 'REQ-3301',
    message: 'New message from Kiran',
    date: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    priority: 'low',
    read: true,
    record: { type: 'UserRequest', id: 3301 },
  },
];

const unread = () => items.filter((i) => !i.read).length;

export const inboxHandlers = [
  http.get(url('/me/notifications/count'), () => HttpResponse.json({ unread: unread() })),
  http.get(url('/me/notifications'), () => HttpResponse.json({ items, unread: unread() })),
  http.post(url('/me/notifications/read-all'), () => {
    const marked = unread();
    items = items.map((i) => ({ ...i, read: true }));
    return HttpResponse.json({ marked });
  }),
  http.post(url('/me/notifications/:id/read'), ({ params }) => {
    items = items.map((i) => (i.id === Number(params['id']) ? { ...i, read: true } : i));
    return new HttpResponse(null, { status: 204 });
  }),
];
