import type { ClassInfo } from '../types';
import { isPickerColumn } from './list-cells';

/** Types with nothing a spreadsheet can hold. */
const NOT_EXPORTABLE = new Set(['Blob', 'Image', 'Document']);

/**
 * The columns a user may pick for an export: `id`, then every stored or
 * derived attribute of the class. Link sets and dashboards have no single
 * value per row and are left out.
 */
export function exportableColumns(info: ClassInfo): string[] {
  const codes = Object.entries(info.fields)
    .filter(([, spec]) => ['scalar', 'picker', 'readonly'].includes(spec.ui) && !NOT_EXPORTABLE.has(spec.type))
    .map(([code]) => code);
  return ['id', ...codes.filter((c) => c !== 'id')];
}

/**
 * The `fields` iTop's exporter is given for the chosen columns. A picker is
 * exported by the name of what it points at (`org_id_friendlyname`), as the
 * list shows it, rather than by a bare id.
 */
export function exportFields(info: ClassInfo, columns: string[]): string {
  return columns.map((c) => (isPickerColumn(info, c) ? `${c}_friendlyname` : c)).join(',');
}

const storageKey = (className: string) => `records.export-columns.${className}`;

/** The columns last exported for this class, still valid for it; null if none. */
export function loadExportColumns(info: ClassInfo): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(info.name));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set(exportableColumns(info));
    const columns = parsed.filter((c): c is string => typeof c === 'string' && allowed.has(c));
    return columns.length > 0 ? columns : null;
  } catch {
    return null;
  }
}

export function saveExportColumns(className: string, columns: string[]): void {
  try {
    window.localStorage.setItem(storageKey(className), JSON.stringify(columns));
  } catch {
    // Private mode or storage full: the choice just isn't remembered.
  }
}
