import { describe, expect, it } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { signIn } from '@/test/render';
import type { Problem, ProblemTransition } from '../types';

/** Exercises the BFF contract against the MSW fake BFF (same handlers as the browser). */
describe('problem lifecycle through the BFF contract', () => {
  async function createProblem() {
    return apiClient.post<Problem>('/problems', {
      org_id: '1',
      caller_id: '2',
      title: 'Lifecycle test',
      description: '<p>Created by a test</p>',
      service_id: null,
      servicesubcategory_id: null,
      product: '',
      impact: '2',
      urgency: '2',
      functionalcis_list: [{ functionalci_id: '12' }],
      contacts_list: [],
      related_incident_ids: ['3'],
    });
  }

  it('creates → assigns → resolves → closes', async () => {
    signIn('admin');
    const created = await createProblem();
    expect(created).toMatchObject({ status: 'new', priority: '2', team_id: null });
    expect(created.related_incident_list.map((i) => i.id)).toEqual(['3']);
    expect(created.functionalcis_list[0]?.functionalci_name).toBe('vpn-gw-01');

    const transitions = await apiClient.get<ProblemTransition[]>(`/problems/${created.id}/transitions`);
    expect(transitions.map((t) => t.stimulus)).toEqual(['ev_assign']);

    const assigned = await apiClient.post<Problem>(`/problems/${created.id}/transitions/ev_assign`, {
      fields: { team_id: '103', agent_id: '4' },
      note: 'Taking this',
    });
    expect(assigned).toMatchObject({ status: 'assigned', team_name: 'Network Operations', agent_name: 'Mei Lin' });
    expect(assigned.assignment_date).not.toBeNull();
    expect(assigned.private_log.at(-1)?.message_html).toBe('<p>Taking this</p>');

    const resolved = await apiClient.post<Problem>(`/problems/${created.id}/transitions/ev_resolve`, {
      fields: { service_id: '2', servicesubcategory_id: '21', product: 'GlobalProtect' },
    });
    expect(resolved).toMatchObject({ status: 'resolved', service_name: 'Network Connectivity', servicesubcategory_name: 'VPN' });

    const closed = await apiClient.post<Problem>(`/problems/${created.id}/transitions/ev_close`, { fields: {} });
    expect(closed.status).toBe('closed');
    expect(closed.close_date).not.toBeNull();
  });

  it('rejects stimuli the state does not allow', async () => {
    signIn('admin');
    const created = await createProblem();
    await expect(
      apiClient.post(`/problems/${created.id}/transitions/ev_close`, { fields: {} }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_stimulus' });
  });

  it('enforces required fields and team membership', async () => {
    signIn('admin');
    const created = await createProblem();
    await expect(
      apiClient.post(`/problems/${created.id}/transitions/ev_assign`, { fields: { team_id: '103' } }),
    ).rejects.toMatchObject({ code: 'missing_field' });
    await expect(
      apiClient.post(`/problems/${created.id}/transitions/ev_assign`, { fields: { team_id: '103', agent_id: '2' } }),
    ).rejects.toMatchObject({ code: 'invalid_value' });
  });

  it('never accepts status or priority writes', async () => {
    signIn('admin');
    const created = await createProblem();
    await expect(apiClient.patch(`/problems/${created.id}`, { status: 'closed' })).rejects.toMatchObject({ code: 'read_only' });
    await expect(apiClient.patch(`/problems/${created.id}`, { priority: '1' })).rejects.toMatchObject({ code: 'read_only' });
    const updated = await apiClient.patch<Problem>(`/problems/${created.id}`, { impact: '1', urgency: '1' });
    expect(updated.priority).toBe('1');
  });

  it('forbids writes for read-only profiles', async () => {
    signIn('agent');
    await expect(createProblem()).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});
