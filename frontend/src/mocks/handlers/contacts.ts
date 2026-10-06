import { HttpResponse, http } from 'msw';
import { orgs, persons, teams } from '../fixtures/reference';
import { api, latency, limit, matchesQuery } from './utils';

export const contactsHandlers = [
  http.get(api('/orgs'), async ({ request }) => {
    await latency();
    const q = new URL(request.url).searchParams.get('q');
    return HttpResponse.json(limit(orgs.filter((o) => matchesQuery(q, o.name)).map((o) => ({ id: o.id, label: o.name }))));
  }),

  // ?orgId= scopes callers to an organization, ?teamId= scopes agents to a team (as iTop does)
  http.get(api('/persons'), async ({ request }) => {
    await latency();
    const params = new URL(request.url).searchParams;
    const q = params.get('q');
    const orgId = params.get('orgId');
    const teamId = params.get('teamId');
    const members = teamId ? (teams.find((t) => t.id === teamId)?.members ?? []) : null;
    const result = persons
      .filter((p) => (!orgId || p.org_id === orgId) && (!members || members.includes(p.id)))
      .filter((p) => matchesQuery(q, p.name, p.email))
      .map((p) => ({ id: p.id, label: p.name, hint: p.email }));
    return HttpResponse.json(limit(result));
  }),

  http.get(api('/teams'), async ({ request }) => {
    await latency();
    const q = new URL(request.url).searchParams.get('q');
    return HttpResponse.json(
      limit(teams.filter((t) => matchesQuery(q, t.name)).map((t) => ({ id: t.id, label: t.name }))),
    );
  }),
];
