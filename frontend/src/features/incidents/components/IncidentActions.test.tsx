import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { env } from '@/config/env';
import { server } from '@/mocks/server';
import { renderWithProviders, screen } from '@/test/render';
import type { IncidentDetail } from '../types';
import { IncidentActions, todayInput } from './IncidentActions';

const incident: IncidentDetail = {
  id: '7',
  ref: 'I-000007',
  summary: 'VPN down',
  status: 'open',
  priority: 'high',
  createdAt: '2026-10-26T09:00:00Z',
  description: '',
  sla: { ttoBreached: false, ttrBreached: false },
  log: [],
  availableActions: ['hold', 'resolve', 'reassign'],
  extrasAvailable: true,
};

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return todayInput(d);
};

describe('IncidentActions: put on hold', () => {
  it('asks for a reason and a next-action date before it puts the incident on hold', async () => {
    let sent: unknown;
    server.use(
      http.post(`${env.bffUrl}/incidents/7/transitions`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...incident, status: 'pending', availableActions: ['assign'] });
      }),
    );
    renderWithProviders(<IncidentActions incident={incident} />);

    await userEvent.click(screen.getByRole('button', { name: 'Put on hold' }));
    const confirm = screen.getByRole('button', { name: /Confirm put on hold/ });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Pending reason'), 'Waiting for logs');
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Next action date'), { target: { value: tomorrow() } });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await screen.findByRole('button', { name: 'Put on hold' });
    expect(sent).toEqual({ action: 'hold', pendingReason: 'Waiting for logs', nextActionDate: tomorrow() });
  });

  it('will not take a next-action date in the past', async () => {
    renderWithProviders(<IncidentActions incident={incident} />);
    await userEvent.click(screen.getByRole('button', { name: 'Put on hold' }));
    await userEvent.type(screen.getByLabelText('Pending reason'), 'Waiting');
    fireEvent.change(screen.getByLabelText('Next action date'), { target: { value: '2020-01-01' } });
    expect(screen.getByRole('button', { name: /Confirm put on hold/ })).toBeDisabled();
  });
});
