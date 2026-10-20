import type { ClassInfo } from '../types';
import { humaniseAttcode } from '../components/FieldControls';

/**
 * The column mapping step of a CSV import: which field each of the file's
 * columns loads into, or null to skip it. The BFF rewrites the header row
 * from it before iTop sees the file.
 */
export type ImportMapping = (string | null)[];

export interface ImportTarget {
  /** What iTop's loader is given: `name`, `id`, or `org_id->friendlyname`. */
  value: string;
  label: string;
}

/**
 * Where a column can go: `id` (to update a record by its id), any writable
 * field, and for a reference both the id of the record it points at and
 * that record's name -- its friendly name, which is what an export from
 * the list writes (a person's is "First Last").
 */
export function importTargets(info: ClassInfo): ImportTarget[] {
  const label = (code: string) => info.labels?.fields?.[code] ?? humaniseAttcode(code);
  const targets: ImportTarget[] = [{ value: 'id', label: 'ID' }];
  for (const code of info.writable) {
    const spec = info.fields[code];
    if (!spec || spec.type === 'CaseLog') continue;
    if (spec.ui === 'picker') {
      targets.push({ value: `${code}->friendlyname`, label: `${label(code)} (name)` });
      targets.push({ value: code, label: `${label(code)} (ID)` });
    } else if (spec.ui === 'scalar') {
      targets.push({ value: code, label: label(code) });
    }
  }
  return targets;
}

/** True when iTop would read the heading as a column of this class as it is. */
export function isImportColumn(info: ClassInfo, heading: string): boolean {
  if (heading === 'id') return true;
  const [code, ...path] = heading.split('->');
  const spec = code ? info.fields[code] : undefined;
  if (!spec) return false;
  return path.length === 0 || (spec.ui === 'picker' && path.every((p) => /^\w+$/.test(p)));
}

/** Whether the file needs mapping before iTop can read its headings. */
export function needsMapping(info: ClassInfo, headings: string[]): boolean {
  return headings.some((h) => !isImportColumn(info, h));
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A first guess at the mapping: a heading that already is a column stays;
 * otherwise it is matched to a field by code or label, ignoring case,
 * spaces and punctuation. A reference matched by its label (as an export
 * from this app writes it) is matched by name, since that is what an export
 * holds. A field is used at most once; the rest is left skipped.
 */
export function suggestMapping(info: ClassInfo, headings: string[]): ImportMapping {
  const used = new Set<string>();
  const label = (code: string) => info.labels?.fields?.[code] ?? humaniseAttcode(code);
  const candidates = importTargets(info).map((t) => t.value).filter((v) => !v.includes('->'));

  const guess = (heading: string): string | null => {
    if (isImportColumn(info, heading)) return heading;
    const [base = '', ...path] = heading.split('->');
    // A trailing "(…)" qualifies the heading: iTop's export writes
    // "id (Primary Key)", and the mapping's own labels end "(ID)" / "(name)".
    const qualifier = /\(([^)]*)\)\s*$/.exec(base)?.[1];
    const n = norm(base.replace(/\s*\([^)]*\)\s*$/, ''));
    const byCode = candidates.find((c) => norm(c) === n);
    const byLabel = candidates.find((c) => c !== 'id' && norm(label(c)) === n);
    const code = byCode ?? byLabel;
    if (!code) return null;
    const isPicker = info.fields[code]?.ui === 'picker';
    if (path.length > 0) {
      // "Organization->Name": the referenced record's name.
      return isPicker && path.length === 1 && norm(path[0]!) === 'name' ? `${code}->name` : null;
    }
    const byId = byCode !== undefined || (qualifier !== undefined && norm(qualifier) === 'id');
    return isPicker && !byId ? `${code}->friendlyname` : code;
  };

  return headings.map((heading) => {
    const target = guess(heading);
    if (target === null || used.has(target)) return null;
    used.add(target);
    return target;
  });
}

/** The headings iTop will see once the mapping is applied. */
export function mappedColumns(mapping: ImportMapping): string[] {
  return mapping.filter((t): t is string => t !== null);
}

/** True when the mapping changes nothing, so the file can be sent as it is. */
export function isIdentityMapping(headings: string[], mapping: ImportMapping): boolean {
  return headings.length === mapping.length && headings.every((h, i) => mapping[i] === h);
}
