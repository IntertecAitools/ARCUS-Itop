import { HttpResponse, http } from 'msw';
import { users } from '../fixtures/reference';
import { api, currentUser, error, latency, toCurrentUser, tokenFor } from './utils';

export const authHandlers = [
  http.post(api('/auth/login'), async ({ request }) => {
    await latency();
    const body = (await request.json()) as { login?: string; password?: string };
    const user = users.find((u) => u.login === body.login?.trim() && u.password === body.password);
    if (!user) return error(401, 'invalid_credentials', 'Invalid login or password.');
    return HttpResponse.json({ token: tokenFor(user.id), user: toCurrentUser(user.id) });
  }),

  http.post(api('/auth/logout'), () => new HttpResponse(null, { status: 204 })),

  http.get(api('/auth/me'), async ({ request }) => {
    await latency();
    const user = currentUser(request);
    return user ? HttpResponse.json(user) : error(401, 'unauthorized', 'Not signed in.');
  }),
];
