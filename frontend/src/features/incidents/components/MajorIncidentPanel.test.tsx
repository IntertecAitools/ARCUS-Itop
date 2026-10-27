import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { env } from '@/config/env';
import { server } from '@/mocks/server';
import { renderWithProviders, screen } from '@/test/render';
import type { IncidentDetail } from '../types';
import { MajorIncidentPanel } from './MajorIncidentPanel';

const base: IncidentDetail = {
  id: '1',
  ref: 'I-000001',
  summary: 'Email down for everyone',
  status: 'open',
  priority: 'critical',
  createdAt: '2026-10-26T09:00:00Z',
  description: '',
  sla: { ttoBreached: false, ttrBreached: false },
  log: [],
  availableActions: ['hold', 'resolve'],
  extrasAvailable: true,
  major: false,
  childIncidents: [],
};

describe('MajorIncidentPanel', () => {
  it('declares an incident major', async () => {
    let sent: unknown;
    server.use(
      http.put(`${env.bffUrl}/incidents/1/major`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...base, major: true });
      }),
    );
    renderWithProviders(<MajorIncidentPanel incident={base} />);
    await userEvent.click(screen.getByRole('button', { name: 'Declare major' }));
    await screen.findByRole('button', { name: 'Declare major' });
    expect(sent).toEqual({ major: true });
  });

  it('lists the linked incidents and posts a stakeholder update to them and by email', async () => {
    const major: IncidentDetail = {
      ...base,
      major: true,
      childIncidents: [{ id: '2', ref: 'I-000002', summary: 'Cannot send mail', status: 'open' }],
    };
    let sent: unknown;
    server.use(
      http.post(`${env.bffUrl}/incidents/1/stakeholder-updates`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ incident: major, postedTo: 1, notified: ['exec@example.com'] });
      }),
    );
    renderWithProviders(<MajorIncidentPanel incident={major} />);
    expect(screen.getByRole('link', { name: 'I-000002' })).toHaveAttribute('href', '/incidents/2');

    await userEvent.type(screen.getByLabelText('Update message'), 'Failover in progress');
    await userEvent.click(screen.getByLabelText('Email the callers'));
    await userEvent.type(screen.getByLabelText('Also email'), 'exec@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Post update' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Posted here and on 1 linked incident; emailed 1.');
    expect(sent).toEqual({
      message: 'Failover in progress',
      postToChildren: true,
      notifyCallers: true,
      notifyEmails: ['exec@example.com'],
    });
  });

  it('is hidden where the platform cannot record major incidents', () => {
    const { container } = renderWithProviders(<MajorIncidentPanel incident={{ ...base, extrasAvailable: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
