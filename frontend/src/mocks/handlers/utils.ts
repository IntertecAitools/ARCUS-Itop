import { HttpResponse, delay } from 'msw';
import { MOCK_BFF_BASE } from '@/config/env';
import type { CurrentUser, LookupOption } from '@/types';
import { orgs, persons, users } from '../fixtures/reference';
import type { TicketRecord } from '../fixtures/seed';

/** Match the mock BFF path on any origin */
export const api = (path: string) => `*${MOCK_BFF_BASE}${path}`;

/** Simulated network latency (short in tests) */
export const latency = () => delay(typeof window === 'undefined' || process.env.NODE_ENV === 'test' ? 0 : 180);

export function error(status: number, code: string, message: string) {
  return HttpResponse.json({ code, message }, { status });
}

export const notFound = (what: string, id: string) => error(404, 'not_found', `${what} ${id} does not exist.`);

export function paginate<T>(items: T[], url: URL) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get('pageSize')) || 10));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

export function matchesQuery(q: string | null, ...values: Array<string | null | undefined>): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return values.some((v) => v?.toLowerCase().includes(needle));
}

export function limit(options: LookupOption[], max = 50): LookupOption[] {
  return options.slice(0, max);
}

/** Typeahead options for Incident / UserRequest pickers, newest first */
export function ticketLookup(list: TicketRecord[], q: string | null): LookupOption[] {
  return limit(
    list
      .filter((t) => matchesQuery(q, t.ref, t.title))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
      .map((t) => ({
        id: t.id,
        label: `${t.ref} · ${t.title}`,
        hint: [t.status, orgs.find((o) => o.id === t.org_id)?.name].filter(Boolean).join(' · '),
      })),
  );
}

export const personName =(id: string | null) => (id ? (persons.find((p) => p.id === id)?.name ?? null) : null);

/** Escape plain text into a <p> for case log entries */
export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

export function toCurrentUser(userId: string): CurrentUser | null {
  const user = users.find((u) => u.id === userId);
  if (!user) return null;
  const person = persons.find((p) => p.id === user.person_id)!;
  return {
    id: user.id,
    login: user.login,
    name: person.name,
    roleCode: user.roleCode,
    profiles: user.profiles,
    personId: person.id,
    orgId: person.org_id,
  };
}

export const tokenFor = (userId: string) => `mock-token-${userId}`;

/** The signed-in user from the Bearer token, or null */
export function currentUser(request: Request): CurrentUser | null {
  const match = /^Bearer mock-token-(.+)$/.exec(request.headers.get('Authorization') ?? '');
  return match ? toCurrentUser(match[1]!) : null;
}

const WRITERS = ['Administrator', 'Problem Manager'];

/** 401 without a session, 403 without a write profile; null when allowed */
export function requireWriter(request: Request) {
  const user = currentUser(request);
  if (!user) return { user: null, denied: error(401, 'unauthorized', 'Your session has expired. Please sign in again.') };
  if (!user.profiles.some((p) => WRITERS.includes(p))) {
    return { user, denied: error(403, 'forbidden', 'Your profile does not allow modifying this object.') };
  }
  return { user, denied: null };
}

export function requireUser(request: Request) {
  const user = currentUser(request);
  return { user, denied: user ? null : error(401, 'unauthorized', 'Your session has expired. Please sign in again.') };
}
