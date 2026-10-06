import { HttpResponse, http } from 'msw';
import { cis } from '../fixtures/reference';
import { api, latency, limit, matchesQuery } from './utils';

export const cmdbHandlers = [
  http.get(api('/cis'), async ({ request }) => {
    await latency();
    const q = new URL(request.url).searchParams.get('q');
    return HttpResponse.json(
      limit(cis.filter((c) => matchesQuery(q, c.name, c.finalclass)).map((c) => ({ id: c.id, label: c.name, hint: c.finalclass }))),
    );
  }),
];
