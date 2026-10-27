import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';

const url = (path: string) => `${env.bffUrl}${path}`;

/** Email to ticket is off in the mock, as on a BFF without MAIL_INTAKE_SOURCE. */
const OFF = { enabled: false, totals: { created: 0, updated: 0, skipped: 0, failed: 0 } };

export const mailIntakeHandlers = [
  http.get(url('/admin/mail-intake'), () => HttpResponse.json(OFF)),
  http.post(url('/admin/mail-intake/run'), () =>
    HttpResponse.json(
      { error: { code: 'conflict', message: 'Email to ticket is off: set MAIL_INTAKE_SOURCE.' } },
      { status: 409 },
    ),
  ),
];
