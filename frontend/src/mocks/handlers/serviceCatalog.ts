import { HttpResponse, http } from 'msw';
import { services } from '../fixtures/reference';
import { api, latency, limit, matchesQuery, notFound } from './utils';

export const serviceCatalogHandlers = [
  // Every demo organization subscribes to every service, so ?orgId= does not filter here.
  http.get(api('/services'), async ({ request }) => {
    await latency();
    const q = new URL(request.url).searchParams.get('q');
    return HttpResponse.json(
      limit(services.filter((s) => matchesQuery(q, s.name)).map((s) => ({ id: s.id, label: s.name }))),
    );
  }),

  http.get(api('/services/:id/subcategories'), async ({ params, request }) => {
    await latency();
    const service = services.find((s) => s.id === params.id);
    if (!service) return notFound('Service', String(params.id));
    const q = new URL(request.url).searchParams.get('q');
    return HttpResponse.json(
      service.subcategories.filter((sc) => matchesQuery(q, sc.name)).map((sc) => ({ id: sc.id, label: sc.name })),
    );
  }),
];
