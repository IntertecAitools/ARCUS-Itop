import { describe, expect, it } from 'vitest';
import { drillDownTitle, metricText, metricTone, paramsFromQuery, queryFromParams, ticketHref } from './sla';
import type { SlaDashboard, SlaMetric, SlaTicket } from '../types';

const metric = (state: SlaMetric['state'], percentUsed: number | null): SlaMetric => ({
  state,
  percentUsed,
  deadline: null,
  goalSeconds: 3600,
});

describe('sla helpers', () => {
  it('describes a stopwatch in a few words', () => {
    expect(metricText(metric('within', 40))).toBe('40% used');
    expect(metricText(metric('at_risk', 80))).toBe('80% used');
    expect(metricText(metric('breached', 130))).toBe('Breached (130%)');
    expect(metricText(metric('met', 20))).toBe('Met');
    expect(metricText(metric('paused', 35))).toBe('Paused at 35%');
    expect(metricText(metric('none', null))).toBe('No SLA');
    expect(metricTone(metric('at_risk', 80))).toBe('warning');
    expect(metricTone(metric('breached', 100))).toBe('critical');
  });

  it('reads the drill-down from the URL and ignores anything malformed', () => {
    expect(queryFromParams(new URLSearchParams('type=incident&state=at_risk&team=none&priority=2&org=3'))).toEqual({
      type: 'incident',
      state: 'at_risk',
      team: 'none',
      priority: '2',
      org: '3',
    });
    expect(queryFromParams(new URLSearchParams('type=problem&state=late&team=x&priority=9&org=1;'))).toEqual({
      type: 'all',
      state: undefined,
      team: undefined,
      priority: undefined,
      org: undefined,
    });
    expect(paramsFromQuery({ type: 'all', state: 'breached', team: '5' })).toEqual({ state: 'breached', team: '5' });
  });

  it('names the drill-down from the dashboard labels', () => {
    const dashboard = {
      byTeam: [{ key: '5', label: 'Service desk' }],
      byCustomer: [{ key: '3', label: 'Acme' }],
    } as unknown as SlaDashboard;
    expect(drillDownTitle({ type: 'all', state: 'breached', team: '5' }, dashboard)).toBe('Breached · Team: Service desk');
    expect(drillDownTitle({ type: 'all', team: 'none', priority: '1', org: '3' }, dashboard)).toBe(
      'Team: No team · Priority: Critical · Customer: Acme',
    );
  });

  it('opens incidents on their own screen when that module exists', () => {
    const incident = { id: '7', className: 'Incident' } as SlaTicket;
    const request = { id: '8', className: 'UserRequest' } as SlaTicket;
    expect(ticketHref(incident, true)).toBe('/incidents/7');
    expect(ticketHref(incident, false)).toBe('/records/Incident/7');
    expect(ticketHref(request, true)).toBe('/records/UserRequest/8');
  });
});
