import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import { readStored, writeStored } from '../storage';

const url = (path: string) => `${env.bffUrl}${path}`;

/** The staff account mock mode signs in as: an administrator, so every screen is reachable. */
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

/** An end user, for the self-service portal. Any login starting with "portal" signs in as them. */
export const mockPortalUser = {
  id: 7,
  login: 'portal',
  name: 'Pia Portal',
  email: 'pia.portal@example.test',
  kind: 'portal',
  profiles: ['Portal user'],
  isAdmin: false,
  contactId: 9,
  orgId: 1,
};

type Session = 'admin' | 'portal' | 'none';

/**
 * Who is signed in. Absent means the administrator, so `npm run dev` opens
 * straight onto the app; the browser tests store `none` to start at sign-in.
 * Kept in sessionStorage so a reload keeps the session, as the BFF's cookie would.
 */
const session = () => readStored<Session>('session', 'admin');
export const currentMockUser = () => (session() === 'portal' ? mockPortalUser : mockUser);

/**
 * Sign-in in mock mode: any non-empty login and password work, so screens can
 * be built without the BFF. The real checks live in the BFF and are tested there.
 */
export const authHandlers = [
  http.get(url('/auth/me'), () =>
    session() !== 'none'
      ? HttpResponse.json({ user: currentMockUser() })
      : HttpResponse.json({ error: { code: 'unauthorized', message: 'Not signed in.' } }, { status: 401 }),
  ),
  http.post(url('/auth/login'), async ({ request }) => {
    const { login } = (await request.json()) as { login: string };
    writeStored('session', login.toLowerCase().startsWith('portal') ? 'portal' : 'admin');
    return HttpResponse.json({ user: currentMockUser() });
  }),
  // Password reset: on in mock mode so its screens can be worked on.
  http.get(url('/auth/options'), () => HttpResponse.json({ passwordReset: true })),
  http.post(url('/auth/forgot-password'), () =>
    HttpResponse.json(
      {
        ok: true,
        message: "If an account matches, we've sent a link to its email address. It works once and expires soon.",
      },
      { status: 202 },
    ),
  ),
  http.post(url('/auth/reset-password'), async ({ request }) => {
    const { token } = (await request.json()) as { token: string };
    // Any token works except "expired", which shows the error path.
    return token.startsWith('expired')
      ? HttpResponse.json(
          { error: { code: 'bad_request', message: 'This link has expired or was already used. Ask for a new one.' } },
          { status: 400 },
        )
      : HttpResponse.json({ ok: true });
  }),
  http.post(url('/auth/logout'), () => {
    writeStored('session', 'none');
    return new HttpResponse(null, { status: 204 });
  }),
];
