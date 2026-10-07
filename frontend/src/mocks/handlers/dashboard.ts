import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import {
  emptyNavCounts,
  emptyOverview,
  seededNavCounts,
  seededOverview,
} from '../fixtures/dashboard';

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

  http.get(url('/dashboard/overview'), () =>
    HttpResponse.json(SEEDED ? seededOverview : emptyOverview),
  ),
];
