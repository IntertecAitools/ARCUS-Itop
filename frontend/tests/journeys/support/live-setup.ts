import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BFF_URL, FRONTEND_URL, MAILPIT_URL } from './target';

/**
 * Before a live run: checks the stack is up, and keeps the end-user account
 * the portal journeys sign in as.
 *
 * - The BFF must already be running (`PORT=4600 npm run dev` in backend/, see
 *   frontend/README.md) and reach iTop; Mailpit must answer.
 * - The staff account is E2E_STAFF_LOGIN / E2E_STAFF_PASSWORD, defaulting to
 *   the admin account of the local iTop's unattended install
 *   (docker/itop-install-params.xml).
 * - The portal account is E2E_PORTAL_LOGIN (default `e2e.portal`), a "Portal
 *   user" in the staff account's organisation. Created on the first run; on
 *   every run it is re-enabled and given a fresh random password, which only
 *   this run knows. Nothing else in iTop is touched here.
 *
 * Everything the specs need is handed on through process.env, which
 * Playwright passes to its workers.
 */
const origin = new URL(BFF_URL).origin;

async function probe(url: string, timeoutMs: number) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The installer's admin password, from the response file the local iTop was set up with. */
function installerAdminPassword(): string {
  try {
    const xml = readFileSync(new URL('../../../../docker/itop-install-params.xml', import.meta.url), 'utf8');
    return /<admin_account>[\s\S]*?<pwd>([^<]*)<\/pwd>/.exec(xml)?.[1] ?? '';
  } catch {
    return '';
  }
}

/** A minimal BFF client that carries the session cookie between calls. */
class Bff {
  private cookie = '';

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BFF_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

type User = { id: number; login: string; name: string; email: string; orgId: number; status?: string };

export default async function liveSetup() {
  if (!(await probe(`${origin}/health`, 20_000))) {
    throw new Error(
      `The BFF is not responding at ${origin}.\n\n` +
        `The live journeys need the real stack. Start it first (see frontend/README.md):\n` +
        `  1. local iTop on :8080 and Mailpit on :8025 (docker/docker-compose.local.yml)\n` +
        `  2. cd backend && PORT=4600 CORS_ORIGINS=${FRONTEND_URL} APP_BASE_URL=${FRONTEND_URL} npm run dev\n`,
    );
  }
  const upstream = await probe(`${origin}/health/upstream`, 60_000);
  if (upstream?.status !== 'ok') {
    throw new Error(`The BFF is up but cannot reach iTop (${String(upstream?.error ?? 'no response')}).`);
  }
  if (!(await probe(`${MAILPIT_URL}/api/v1/info`, 20_000))) {
    throw new Error(`Mailpit is not answering at ${MAILPIT_URL}; the live journeys read the emails sent there.`);
  }

  const staff = {
    login: process.env.E2E_STAFF_LOGIN ?? 'admin',
    password: process.env.E2E_STAFF_PASSWORD || installerAdminPassword(),
  };
  if (!staff.password) {
    throw new Error('Set E2E_STAFF_PASSWORD: no password for the staff account was found.');
  }
  const bff = new Bff();
  const { user: me } = await bff.call<{ user: User }>('POST', '/auth/login', staff);

  const portalLogin = process.env.E2E_PORTAL_LOGIN ?? 'e2e.portal';
  const portalEmail = process.env.E2E_PORTAL_EMAIL ?? `${portalLogin}@example.test`;
  const portalPassword = `E2e-${randomBytes(12).toString('base64url')}-9a`;

  const { items } = await bff.call<{ items: User[] }>('GET', `/admin/users?q=${encodeURIComponent(portalLogin)}`);
  const existing = items.find((u) => u.login === portalLogin);
  if (existing) {
    if (existing.status !== 'enabled') await bff.call('PATCH', `/admin/users/${existing.id}`, { status: 'enabled' });
    await bff.call('POST', `/admin/users/${existing.id}/password`, { password: portalPassword });
  } else {
    const { profiles } = await bff.call<{ profiles: Array<{ id: number; name: string }> }>('GET', '/admin/profiles');
    const portalProfile = profiles.find((p) => p.name === 'Portal user');
    if (!portalProfile) throw new Error('iTop has no "Portal user" profile.');
    await bff.call('POST', '/admin/users', {
      type: 'local',
      login: portalLogin,
      password: portalPassword,
      contact: { firstName: 'E2E', lastName: 'Portal user', email: portalEmail, orgId: me.orgId },
      profileIds: [portalProfile.id],
    });
  }
  await bff.call('POST', '/auth/logout');

  Object.assign(process.env, {
    E2E_STAFF_LOGIN: staff.login,
    E2E_STAFF_PASSWORD: staff.password,
    E2E_STAFF_NAME: me.name,
    E2E_PORTAL_LOGIN: portalLogin,
    E2E_PORTAL_PASSWORD: portalPassword,
    E2E_PORTAL_EMAIL: portalEmail,
  });
}
