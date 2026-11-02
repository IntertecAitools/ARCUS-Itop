import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { AutoCloseDto, AutoCloseRun, AutoCloseSettings } from '@/features/auto-close';

const url = (path: string) => `${env.bffUrl}${path}`;

/** Mock auto-close: the BFF's defaults in memory; a run closes one ticket and reminds about another. */
const DEFAULTS: AutoCloseSettings = {
  enabled: true,
  days: 7,
  requests: true,
  incidents: true,
  remind: true,
  remindDaysBefore: 2,
};

let settings: AutoCloseSettings = { ...DEFAULTS };
let updatedAt = '';
let lastRun: AutoCloseRun | undefined;

const dto = (): AutoCloseDto => ({
  ...settings,
  mailConfigured: true,
  checkEveryMinutes: 60,
  updatedAt,
  updatedBy: updatedAt ? 'admin' : '',
  ...(lastRun ? { lastRun } : {}),
});

export const autoCloseHandlers = [
  http.get(url('/admin/auto-close'), () => HttpResponse.json(dto())),

  http.put(url('/admin/auto-close'), async ({ request }) => {
    const body = (await request.json()) as AutoCloseSettings;
    if (body.remind && body.remindDaysBefore >= body.days) {
      return HttpResponse.json(
        { error: { code: 'bad_request', message: 'The reminder has to go before the ticket closes.' } },
        { status: 400 },
      );
    }
    settings = body;
    updatedAt = new Date().toISOString();
    return HttpResponse.json(dto());
  }),

  http.post(url('/admin/auto-close/run'), () => {
    const now = new Date().toISOString();
    lastRun = {
      startedAt: now,
      finishedAt: now,
      truncated: false,
      outcomes: settings.enabled
        ? [
            { class: 'UserRequest', id: '11', ref: 'R-000011', action: 'closed' },
            { class: 'Incident', id: '21', ref: 'I-000021', action: 'reminded' },
          ]
        : [],
    };
    return HttpResponse.json(lastRun);
  }),
];

/** Puts the mock back as it started (tests). */
export function resetAutoCloseMock() {
  settings = { ...DEFAULTS };
  updatedAt = '';
  lastRun = undefined;
}
