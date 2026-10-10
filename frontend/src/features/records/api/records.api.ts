import { apiClient } from '@/lib/api-client';
import type {
  ClassInfo,
  ClassList,
  PickerOption,
  RecordDto,
  RecordFilters,
  RecordList,
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
