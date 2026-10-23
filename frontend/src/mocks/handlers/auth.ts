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

type Session = 'admin' | 'portal' | 'none' | 'mfa-verify' | 'mfa-enrol';

/**
 * Who is signed in. Absent means the administrator, so `npm run dev` opens
 * straight onto the app; the browser tests store `none` to start at sign-in.
 * Kept in sessionStorage so a reload keeps the session, as the BFF's cookie would.
 */
const session = () => readStored<Session>('session', 'admin');
const signedIn = () => session() === 'admin' || session() === 'portal';
const pendingStep = () => (session() === 'mfa-verify' ? 'verify' : session() === 'mfa-enrol' ? 'enrol' : null);

/** In mock mode "123456" is the right authenticator code; anything else is wrong. */
const MOCK_CODE = '123456';
export const currentMockUser = () => (session() === 'portal' ? mockPortalUser : mockUser);

const wrongCode = () =>
  HttpResponse.json(
    {
      error: {
        code: 'unauthorized',
        message: 'That code is not right. Check your authenticator app and try again.',
        details: { attemptsLeft: 4 },
      },
    },
    { status: 401 },
  );

/**
 * Sign-in in mock mode: any non-empty login and password work, so screens can
 * be built without the BFF. The real checks live in the BFF and are tested there.
 * A login starting with "mfa" is asked for an authenticator code, one starting
 * with "enrol" sets one up (the code is always 123456; recovery codes work too).
 */
export const authHandlers = [
  http.get(url('/auth/me'), () => {
    if (signedIn()) return HttpResponse.json({ user: currentMockUser() });
    const step = pendingStep();
    return HttpResponse.json(
      { error: { code: 'unauthorized', message: 'Not signed in.', ...(step ? { details: { mfa: { step } } } : {}) } },
      { status: 401 },
    );
  }),
  http.post(url('/auth/login'), async ({ request }) => {
    const { login } = (await request.json()) as { login: string };
    const lower = login.toLowerCase();
    if (lower.startsWith('mfa') || lower.startsWith('enrol')) {
      const step = lower.startsWith('mfa') ? 'verify' : 'enrol';
      writeStored('session', `mfa-${step}`);
      return HttpResponse.json({ mfa: { step } });
    }
    writeStored('session', lower.startsWith('portal') ? 'portal' : 'admin');
    return HttpResponse.json({ user: currentMockUser() });
  }),
  http.post(url('/auth/mfa/verify'), async ({ request }) => {
    const body = (await request.json()) as { code?: string; recoveryCode?: string };
    if (body.code !== MOCK_CODE && !body.recoveryCode) return wrongCode();
    writeStored('session', 'admin');
    return HttpResponse.json({ user: currentMockUser() });
  }),
  http.get(url('/auth/mfa/enrol'), () =>
    HttpResponse.json({
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Arcus%20Helpdesk:admin%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Arcus%20Helpdesk',
      account: 'admin@example.test',
    }),
  ),
  http.post(url('/auth/mfa/enrol'), async ({ request }) => {
    const { code } = (await request.json()) as { code: string };
    if (code !== MOCK_CODE) return wrongCode();
    writeStored('session', 'admin');
    return HttpResponse.json({
      user: currentMockUser(),
      recoveryCodes: ['abcde-fghij', 'klmno-pqrst', 'uvwxy-z2345', 'a6b7c-d2e3f', 'ghijk-lmnop', 'qrstu-vwxyz', 'bcdef-ghijk', 'lmnop-qrstu', 'vwxyz-abcde', 'fghij-klmno'],
    });
  }),
  // Password reset: on in mock mode so its screens can be worked on. No
  // single sign-on: its round trip needs a real identity provider.
  http.get(url('/auth/options'), () => HttpResponse.json({ passwordReset: true, sso: null, passwordSignIn: 'all' })),
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
