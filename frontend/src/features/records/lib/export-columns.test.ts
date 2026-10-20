import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassInfo } from '../types';
import { exportableColumns, exportFields, loadExportColumns, saveExportColumns } from './export-columns';

const info = {
  name: 'UserRequest',
  writable: ['title', 'org_id'],
  fields: {
    ref: { type: 'String', ui: 'readonly' },
    title: { type: 'String', ui: 'scalar' },
    org_id: { type: 'ExternalKey', ui: 'picker', target: 'Organization' },
    contacts_list: { type: 'LinkedSetIndirect', ui: 'related' },
    attachment: { type: 'Blob', ui: 'scalar' },
    dashboard: { type: 'Dashboard', ui: 'ignored' },
  },
  labels: { class: 'User Request', fields: {}, values: {} },
} as unknown as ClassInfo;

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('export columns', () => {
  it('offers id and every single-valued attribute, not link sets, files or dashboards', () => {
    expect(exportableColumns(info)).toEqual(['id', 'ref', 'title', 'org_id']);
  });

  it('exports a picker by the name of what it points at', () => {
    expect(exportFields(info, ['id', 'title', 'org_id'])).toBe('id,title,org_id_friendlyname');
  });

  it('remembers the last choice per class', () => {
    expect(loadExportColumns(info)).toBeNull();
    saveExportColumns('UserRequest', ['title', 'id']);
    expect(loadExportColumns(info)).toEqual(['title', 'id']);
    expect(loadExportColumns({ ...info, name: 'Incident' } as ClassInfo)).toBeNull();
  });

  it('drops remembered columns the class no longer has, and ignores junk', () => {
    window.localStorage.setItem('records.export-columns.UserRequest', JSON.stringify(['gone', 'title', 3]));
    expect(loadExportColumns(info)).toEqual(['title']);
    window.localStorage.setItem('records.export-columns.UserRequest', '{not json');
    expect(loadExportColumns(info)).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveExportColumns('UserRequest', ['title'])).not.toThrow();
    expect(loadExportColumns(info)).toBeNull();
  });
});
