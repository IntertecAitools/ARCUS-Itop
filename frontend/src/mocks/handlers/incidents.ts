import { HttpResponse, http } from 'msw';
import { getDb } from '../fixtures/db';
import { api, latency, ticketLookup } from './utils';

/** Incident picker (?q= typeahead) */
export const incidentsHandlers = [
  http.get(api('/incidents'), async ({ request }) => {
    await latency();
    return HttpResponse.json(ticketLookup(getDb().incidents, new URL(request.url).searchParams.get('q')));
  }),
];
