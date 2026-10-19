import { apiClient } from '@/lib/api-client';
import type {
  ClassInfo,
  ClassList,
  Criterion,
  BulkRequest,
  BulkResult,
  DeletePlan,
  ExportFormat,
  HistoryResult,
  ImportReport,
  ImportRequest,
  PickerOption,
  RecordDto,
  RecordFilters,
  RecordList,
  RelationGraph,
} from '../types';

const PAGE_SIZE = 25;

/**
 * Generic access to any iTop class, through the BFF.
 *
 * Every call here goes to our own API — the frontend never speaks OQL and
 * never reaches iTop directly. The BFF owns the translation.
 */
export const getClasses = () => apiClient.get<ClassList>('/meta/classes');

export const getClassInfo = (className: string) =>
  apiClient.get<ClassInfo>(`/meta/classes/${className}`);

export function listRecords(className: string, filters: RecordFilters, fields?: string) {
  return apiClient.get<RecordList>(`/objects/${className}`, {
    query: {
      page: filters.page,
      limit: PAGE_SIZE,
      q: filters.q,
      sort: filters.sort,
      order: filters.order,
      view: filters.view,
      criteria: filters.criteria?.length ? JSON.stringify(filters.criteria) : undefined,
      fields,
    },
  });
}

export const getRecord = (className: string, id: string, fields?: string) =>
  apiClient.get<RecordDto>(`/objects/${className}/${id}`, { query: { fields } });

export const createRecord = (className: string, fields: Record<string, unknown>) =>
  apiClient.post<{ object: RecordDto; rejected: Array<{ field: string; reason: string }> }>(
    `/objects/${className}`,
    { fields },
  );

export const updateRecord = (className: string, id: string, fields: Record<string, unknown>) =>
  apiClient.patch<{ object: RecordDto; rejected: Array<{ field: string; reason: string }> }>(
    `/objects/${className}/${id}`,
    { fields },
  );

/** Options for one picker field, resolved by the BFF. */
export const getFieldOptions = (className: string, attcode: string) =>
  apiClient.get<{ options: PickerOption[]; total: number; truncated: boolean }>(
    `/meta/classes/${className}/fields/${attcode}/options`,
  );

/** Objects on the far side of a LinkedSet — iTop's related-object tabs. */
export const getRelated = (className: string, id: string, attcode: string, fields?: string) =>
  apiClient.get<RecordList>(`/objects/${className}/${id}/links/${attcode}`, {
    query: { fields, limit: 100 },
  });

/**
 * Apply a lifecycle action to a record.
 *
 * The action id is whatever the BFF published for this class — it is never
 * written down here, which is why the architecture guard that bans iTop's
 * stimulus vocabulary from the UI still passes. iTop decides what an action
 * does and which fields it demands, so the BFF forwards it rather than the
 * frontend trying to compute the next state.
 */
export const applyStimulus = (
  className: string,
  id: string,
  stimulus: string,
  fields: Record<string, unknown> = {},
) =>
  apiClient.post<{ object: RecordDto }>(`/objects/${className}/${id}/stimulus`, {
    stimulus,
    fields,
  });

/**
 * Delete a record, or with `simulate` only report what deleting it would do.
 *
 * iTop can cascade a delete onto other records, so the screen always asks
 * for the plan first and shows it before the real delete is sent.
 */
export const deleteRecord = (className: string, id: string, simulate: boolean) =>
  apiClient.delete<DeletePlan>(`/objects/${className}/${id}`, {
    query: { simulate: simulate ? 'true' : undefined },
  });

/** A record's change history, newest first. */
export const getHistory = (className: string, id: string) =>
  apiClient.get<HistoryResult>(`/objects/${className}/${id}/history`);

/** Link one object into a related set (the far object, for an n-n set). */
export const addLink = (className: string, id: string, attcode: string, targetId: number) =>
  apiClient.post<{ object: RecordDto }>(`/objects/${className}/${id}/links/${attcode}`, {
    targetId,
  });

/** Remove one row, by the id the related listing returned for it. */
export const removeLink = (className: string, id: string, attcode: string, itemId: number) =>
  apiClient.delete<null>(`/objects/${className}/${id}/links/${attcode}/${itemId}`);

/**
 * Searchable options for linking: a picker attribute's options when given
 * one (the far side of an n-n link class), else any record of the class.
 */
export const searchOptions = (target: { className: string; attcode?: string }, q: string) =>
  target.attcode
    ? apiClient.get<{ options: PickerOption[]; total: number; truncated: boolean }>(
        `/meta/classes/${target.className}/fields/${target.attcode}/options`,
        { query: { q: q || undefined, limit: 20 } },
      )
    : apiClient.get<{ options: PickerOption[]; total: number; truncated: boolean }>(
        `/lookups/${target.className}`,
        { query: { q: q || undefined, limit: 20 } },
      );

/** One action on many records; answers with each record's outcome. */
export const runBulk = (className: string, request: BulkRequest) =>
  apiClient.post<BulkResult>(`/objects/${className}/bulk`, request);

/** The combined deletion plan for several records, without deleting. */
export const getBulkDeletePlan = (className: string, ids: number[]) =>
  apiClient.post<DeletePlan>(`/objects/${className}/bulk/delete-plan`, { ids });

/**
 * The rows a list shows, as a file iTop renders. Same `view` and `q` as the
 * list, so what is downloaded is what is on screen (every page of it).
 */
export const exportRecords = (
  className: string,
  format: ExportFormat,
  filters: { q?: string; view?: string; criteria?: Criterion[] },
) =>
  apiClient.getBlob(`/objects/${className}/export`, {
    format,
    q: filters.q,
    view: filters.view,
    criteria: filters.criteria?.length ? JSON.stringify(filters.criteria) : undefined,
  });

/**
 * The impact graph: what this record impacts (`down`) or depends on (`up`),
 * through iTop's `impacts` relation.
 */
export const getImpact = (className: string, id: string, direction: 'up' | 'down', depth: number) =>
  apiClient.get<RelationGraph>(`/objects/${className}/${id}/related`, {
    query: { relation: 'impacts', direction, depth },
  });

/** iTop's CSV import; `simulate: true` checks every line and writes nothing. */
export const importRecords = (className: string, request: ImportRequest) =>
  apiClient.post<ImportReport>(`/objects/${className}/import`, request);
