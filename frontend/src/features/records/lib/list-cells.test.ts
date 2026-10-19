import { describe, expect, it } from 'vitest';
import type { ClassInfo } from '../types';
import { listCell, listFields } from './list-cells';

/** Problem's list columns as iTop declares them: two of them are pickers. */
const info = {
  name: 'Problem',
  writable: ['title', 'org_id', 'service_id', 'status'],
  fields: {
    title: { type: 'String', ui: 'scalar' },
    org_id: { type: 'ExternalKey', ui: 'picker', target: 'Organization' },
    service_id: { type: 'ExternalKey', ui: 'picker', target: 'Service' },
    status: { type: 'Enum', ui: 'scalar' },
  },
  labels: { values: { status: { assigned: 'Assigned' } } },
} as unknown as ClassInfo;

describe('list cells', () => {
  it('asks for the name beside every picker column', () => {
    expect(listFields(info, ['title', 'org_id', 'status'])).toEqual([
      'title',
      'org_id',
      'org_id_friendlyname',
      'status',
    ]);
  });

  it('shows a picker by name, linked to the record, never as its id', () => {
    const cell = listCell(info, 'org_id', { org_id: '1', org_id_friendlyname: 'My Company/Department' });
    expect(cell).toEqual({ text: 'My Company/Department', to: '/records/Organization/1' });
  });

  it("treats iTop's 0 as no link", () => {
    expect(listCell(info, 'service_id', { service_id: '0', service_id_friendlyname: '' })).toEqual({
      text: '—',
    });
  });

  it('falls back to the id, marked as one, when no name came back', () => {
    expect(listCell(info, 'org_id', { org_id: '5' }).text).toBe('#5');
  });

  it('keeps enum wording and the empty dash for ordinary columns', () => {
    expect(listCell(info, 'status', { status: 'assigned' }).text).toBe('Assigned');
    expect(listCell(info, 'title', { title: '' }).text).toBe('—');
  });
});
