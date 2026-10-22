import { describe, expect, it } from 'vitest';
import type { NavGroup } from '../types';
import { activeEntryId, activeGroupId } from './active';

const entry = (id: string, kind: 'list' | 'search' | 'create' | 'dashboard', filtered = false) => ({
  id,
  kind,
  class: 'Incident',
  label: id,
  filtered,
  creatable: true,
});

const groups: NavGroup[] = [
  { id: 'Welcome', label: 'Welcome', isAdmin: false, entries: [entry('WelcomeMenuPage', 'dashboard')] },
  {
    id: 'IncidentManagement',
    label: 'Incident Management',
    isAdmin: false,
    entries: [
      entry('Incident:Overview', 'dashboard'),
      entry('NewIncident', 'create'),
      entry('SearchIncidents', 'search'),
      entry('Incident:MyIncidents', 'list', true),
      entry('Incident:EscalatedIncidents', 'list', true),
      entry('Incident:OpenIncidents', 'list', true),
      entry('Incident:AllIncidents', 'list'),
    ],
  },
];

describe('activeEntryId', () => {
  it('lights only the view the address names', () => {
    expect(activeEntryId(groups, '/records/Incident', '?view=Incident%3AOpenIncidents')).toBe('Incident:OpenIncidents');
  });

  it('prefers the plain list over the search page when there is no view', () => {
    expect(activeEntryId(groups, '/records/Incident', '')).toBe('Incident:AllIncidents');
  });

  it('ignores paging and search parameters', () => {
    expect(activeEntryId(groups, '/records/Incident', '?view=Incident%3AMyIncidents&page=2&q=vpn')).toBe(
      'Incident:MyIncidents',
    );
  });

  it('lights nothing for a view no entry names', () => {
    expect(activeEntryId(groups, '/records/Incident', '?view=Nope')).toBeNull();
  });

  it('matches dashboards by id', () => {
    expect(activeEntryId(groups, '/dashboards/Incident%3AOverview', '')).toBe('Incident:Overview');
    expect(activeEntryId(groups, '/dashboards/WelcomeMenuPage', '')).toBe('WelcomeMenuPage');
  });

  it('lights nothing on a page outside the tree', () => {
    expect(activeEntryId(groups, '/dashboard', '')).toBeNull();
    expect(activeEntryId(groups, '/records/Incident/12', '')).toBeNull();
  });
});

describe('activeGroupId', () => {
  it('finds the group holding the active entry', () => {
    expect(activeGroupId(groups, 'Incident:OpenIncidents')).toBe('IncidentManagement');
    expect(activeGroupId(groups, null)).toBeNull();
  });
});
