import type { MappingOptions } from '@/features/records';
import type { ImportClass, PlannedAction, RowOutcome, SyncAttribute } from '../types';

/**
 * The fields a reference column can name its record by, first preferred. A
 * person is found by full name ("Ann Doe") or email; anything else by its
 * name, which is unique within an organisation for the classes the import
 * points at (organisations, locations, brands, models, systems).
 */
export const LOOKUPS: MappingOptions = {
  lookups: (target) =>
    target === 'Person' || target === 'Contact'
      ? [
          { value: 'friendlyname', label: 'full name' },
          { value: 'email', label: 'email' },
        ]
      : [{ value: 'name', label: 'name' }],
};

const base = (target: string) => target.split('->')[0] ?? target;

/**
 * The class's usual keys, as the file's mapped columns spell them: a default
 * key `org_id->name` is matched by whichever column fills `org_id`. Keys the
 * file does not have are left out.
 */
export function defaultKeys(cls: ImportClass | undefined, columns: string[]): string[] {
  if (!cls) return [];
  return cls.defaultKeys.flatMap((key) => {
    const column = columns.includes(key) ? key : columns.find((c) => base(c) === base(key));
    return column ? [column] : [];
  });
}

/** A browser File as base64, for the BFF's file reader. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export const ACTION_LABEL: Record<PlannedAction, string> = {
  create: 'Create',
  update: 'Update',
  unchanged: 'Unchanged',
  error: 'Error',
};

export const OUTCOME_LABEL: Record<RowOutcome, string> = {
  created: 'Created',
  updated: 'Updated',
  unchanged: 'Unchanged',
  error: 'Error',
};

export const TONE: Record<PlannedAction | RowOutcome, 'good' | 'info' | 'neutral' | 'critical'> = {
  create: 'good',
  created: 'good',
  update: 'info',
  updated: 'info',
  unchanged: 'neutral',
  error: 'critical',
};

/** The columns a feed's file can fill: its own id, then what the source writes or matches on. */
export function syncTargets(attributes: SyncAttribute[]): string[] {
  return ['primary_key', ...attributes.filter((a) => a.update || a.reconcile).map((a) => a.attcode)];
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A heading that names a target (ignoring case and punctuation) goes there; the rest is skipped. */
export function suggestSyncColumns(headings: string[], targets: string[]): (string | null)[] {
  const used = new Set<string>();
  return headings.map((heading) => {
    const n = norm(heading);
    const target = targets.find((t) => norm(t) === n || (t === 'primary_key' && (n === 'id' || n === 'externalid')));
    if (!target || used.has(target)) return null;
    used.add(target);
    return target;
  });
}

/** "2 h", "30 min", "1 day": a duration in seconds, as a person reads it. */
export function duration(seconds: number): string {
  if (!seconds) return 'never';
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${Math.round(seconds / 60)} min`;
}
