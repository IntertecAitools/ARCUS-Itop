import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';

const url = (path: string) => `${env.bffUrl}${path}`;

/** The account mock mode signs in as: an administrator, so every screen is reachable. */
const mockUser = {
  id: 1,
  login: 'admin',
  name: 'Mock Administrator',
  email: 'admin@example.test',
  kind: 'staff',
  profiles: ['Administrator'],
  isAdmin: true,
  contactId: 1,
  orgId: 1,
};

let signedIn = true;

/**
 * Sign-in in mock mode: any non-empty login and password work, so screens can
 * be built without the BFF. The real checks live in the BFF and are tested there.
 */
export const authHandlers = [
  http.get(url('/auth/me'), () =>
    signedIn
      ? HttpResponse.json({ user: mockUser })
      : HttpResponse.json({ error: { code: 'unauthorized', message: 'Not signed in.' } }, { status: 401 }),
  ),
  http.post(url('/auth/login'), () => {
    signedIn = true;
    return HttpResponse.json({ user: mockUser });
  }),
  http.post(url('/auth/logout'), () => {
    signedIn = false;
    return new HttpResponse(null, { status: 204 });
  }),
];
