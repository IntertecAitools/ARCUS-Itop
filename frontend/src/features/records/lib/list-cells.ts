import { dateTimeText } from '@/lib/utils';
import type { ClassInfo } from '../types';

/**
 * What a list cell shows for one attribute.
 *
 * A picker (an external key such as `org_id`) holds an integer id; showing
 * it reads as "Organization: 1". iTop also returns `<attcode>_friendlyname`
 * beside every external key, which is the name its own lists display, so the
 * list asks for that too and shows it, linked to the record it names.
 */
export interface ListCell {
  text: string;
  /** In-app link to the record a picker points at. */
  to?: string;
}

const EMPTY = '—';

/** True when the column is a reference to another record. */
export function isPickerColumn(info: ClassInfo, attcode: string): boolean {
  const spec = info.fields[attcode];
  return spec?.ui === 'picker' && Boolean(spec.target);
}

/** The output fields a set of columns needs: each picker brings its name. */
export function listFields(info: ClassInfo, columns: string[]): string[] {
  return columns.flatMap((a) => (isPickerColumn(info, a) ? [a, `${a}_friendlyname`] : [a]));
}

export function listCell(
  info: ClassInfo,
  attcode: string,
  fields: Record<string, unknown>,
): ListCell {
  const value = fields[attcode];
  const raw = value === null || value === undefined ? '' : String(value);

  if (isPickerColumn(info, attcode)) {
    // iTop's "no link" is 0, not empty.
    if (raw === '' || raw === '0') return { text: EMPTY };
    const name = String(fields[`${attcode}_friendlyname`] ?? '');
    return {
      text: name || `#${raw}`,
      to: `/records/${info.fields[attcode]!.target}/${raw}`,
    };
  }

  if (raw === '') return { text: EMPTY };
  // DateTimes arrive as exact instants; show them on the viewer's clock.
  if (info.fields[attcode]?.type === 'DateTime') return { text: dateTimeText(raw) };
  // iTop's wording for enum values: `status` reads "Assigned", and
  // impact/urgency are stored as "1".."4" which humanise to nothing.
  return { text: info.labels?.values?.[attcode]?.[raw] ?? raw };
}
