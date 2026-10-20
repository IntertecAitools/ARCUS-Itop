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
    start_date: { type: 'DateTime', ui: 'scalar' },
    due_date: { type: 'Date', ui: 'scalar' },
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

  it("shows a DateTime instant on the viewer's clock, a Date as its day", () => {
    const iso = '2026-10-20T12:04:17.000Z';
    const d = new Date(iso);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(listCell(info, 'start_date', { start_date: iso }).text).toContain(hhmm);
    expect(listCell(info, 'start_date', { start_date: iso }).text).not.toContain('T');
    expect(listCell(info, 'due_date', { due_date: '2026-10-21' }).text).toBe('2026-10-21');
  });
});
