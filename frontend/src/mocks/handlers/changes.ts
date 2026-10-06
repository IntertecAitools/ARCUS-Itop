import { HttpResponse, http } from 'msw';
import { changes } from '../fixtures/reference';
import { api, latency, limit, matchesQuery } from './utils';

export const changesHandlers = [
  // ?open=true → only Changes that are not closed (Problem.related_change_id filter)
  http.get(api('/changes'), async ({ request }) => {
    await latency();
    const params = new URL(request.url).searchParams;
    const q = params.get('q');
    const openOnly = params.get('open') === 'true';
    return HttpResponse.json(
      limit(
        changes
          .filter((c) => (!openOnly || c.status !== 'closed') && matchesQuery(q, c.ref, c.title))
          .map((c) => ({ id: c.id, label: c.ref, hint: `${c.title} · ${c.finalclass} · ${c.status}` })),
      ),
    );
  }),
];
