import { HttpResponse, http } from 'msw';
import { getDb } from '../fixtures/db';
import { api, latency, ticketLookup } from './utils';

/** UserRequest picker (?q= typeahead) */
export const userRequestsHandlers = [
  http.get(api('/user-requests'), async ({ request }) => {
    await latency();
    return HttpResponse.json(ticketLookup(getDb().requests, new URL(request.url).searchParams.get('q')));
  }),
];
