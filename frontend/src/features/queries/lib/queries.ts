import { defaultColumns, isComplete, listFields, type ClassInfo, type Criterion } from '@/features/records';
import type { QueryInput, SavedQuery } from '../types';

/** What the editor holds while a query is written. */
export interface Draft {
  name: string;
  description: string;
  /** `oql` is offered to administrators only. */
  mode: 'conditions' | 'oql';
  recordType: string;
  conditions: Criterion[];
  oql: string;
  columns: string[];
}

export function draftOf(query: SavedQuery | undefined, fallbackType: string): Draft {
  return {
    name: query?.name ?? '',
    description: query?.description ?? '',
    mode: query?.mode ?? 'conditions',
    recordType: query?.recordType || fallbackType,
    conditions: query?.conditions ?? [],
    oql: query?.oql ?? '',
    columns: query?.columns ?? [],
  };
}

/**
 * The draft as the BFF takes it. Half-filled condition rows are left out, as
 * in advanced search; a query written as OQL sends only that and its columns.
 */
export function toInput(draft: Draft, info: ClassInfo | undefined): QueryInput {
  const common = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    ...(draft.columns.length ? { columns: draft.columns } : {}),
  };
  if (draft.mode === 'oql') return { ...common, oql: draft.oql.trim() };
  return {
    ...common,
    recordType: draft.recordType,
    conditions: draft.conditions.filter((c) => isComplete(c, info?.criteria?.[c.field]?.kind)),
  };
}

/** Why the draft cannot be saved yet, or null. Running needs no name. */
export function draftProblem(draft: Draft, forSave: boolean): string | null {
  if (forSave && !draft.name.trim()) return 'Give the query a name.';
  if (draft.mode === 'oql' && !draft.oql.trim()) return 'Write the query.';
  if (draft.mode === 'conditions' && !draft.recordType) return 'Choose the kind of record it lists.';
  return null;
}

/** The columns a result shows: the query's own, else the record type's list columns. */
export function resultColumns(columns: string[], info: ClassInfo): string[] {
  const own = columns.filter((c) => info.fields[c]);
  return own.length ? own : defaultColumns(info);
}

/** iTop's output fields for those columns: the id, and each picker's name. */
export function resultFields(info: ClassInfo, columns: string[]): string {
  return [...new Set(['id', ...listFields(info, columns)])].join(',');
}

/** One line on what a query is, for the list. */
export function describeQuery(query: SavedQuery): string {
  if (query.parameters.length) return 'Used by notifications: needs a record to run against';
  if (!query.recordType) return `Lists ${query.recordTypeLabel || 'records'} the platform does not show`;
  if (query.mode === 'oql') return 'Written in iTop’s query language';
  const n = query.conditions.length;
  return n === 0 ? 'Every record' : n === 1 ? '1 condition' : `${n} conditions`;
}

/** A query's name as a file name: letters, digits and dashes. */
export function fileStem(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .slice(0, 60) || 'query'
  );
}
