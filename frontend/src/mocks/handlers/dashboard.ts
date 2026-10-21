import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import {
  emptyNavCounts,
  emptyOverview,
  seededNavCounts,
  seededOverview,
} from '../fixtures/dashboard';
import { mockFlag } from '../storage';
import { myOpenIncidents } from './incidents';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * The mock serves an EMPTY dashboard — the honest state of an instance with no
 * tickets in it, and the state the empty views are designed against.
 *
 * Flip this to `true` for a populated screen to demo or style against.
 */
const SEEDED = false;

/**
 * One handler file per feature. Every new BFF endpoint gets a handler here, so
 * the UI keeps working with `VITE_API_MODE=mock` and nobody is blocked on the
 * backend to build a screen.
 */
export const dashboardHandlers = [
  http.get(url('/nav/counts'), () =>
    HttpResponse.json(SEEDED ? seededNavCounts : emptyNavCounts),
  ),

  http.get(url('/dashboard/overview'), () => {
    if (SEEDED) return HttpResponse.json(seededOverview);
    // The browser tests' `seeded` flag: an otherwise empty dashboard whose My
    // Assignments are the mock incidents, so a journey can click through.
    if (mockFlag('seeded')) {
      return HttpResponse.json({
        ...emptyOverview,
        myAssignments: { ...emptyOverview.myAssignments, incidents: myOpenIncidents() },
      });
    }
    return HttpResponse.json(emptyOverview);
  }),
];
