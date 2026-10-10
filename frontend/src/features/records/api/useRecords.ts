import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRecord,
  getClassInfo,
  getClasses,
  getFieldOptions,
  getRecord,
  listRecords,
  updateRecord,
} from './records.api';
import type { RecordFilters } from '../types';

/** The class catalogue barely changes; it is the schema, not the data. */
export function useClasses() {
  return useQuery({ queryKey: ['meta', 'classes'], queryFn: getClasses, staleTime: 30 * 60_000 });
}

export function useClassInfo(className: string) {
  return useQuery({
    queryKey: ['meta', 'class', className],
    queryFn: () => getClassInfo(className),
    enabled: Boolean(className),
    staleTime: 30 * 60_000,
  });
}

export function useRecords(className: string, filters: RecordFilters, fields?: string) {
  return useQuery({
    queryKey: ['records', className, filters, fields ?? ''],
    queryFn: () => listRecords(className, filters, fields),
    enabled: Boolean(className),
    placeholderData: (previous) => previous,
  });
}

export function useRecord(className: string, id: string, fields?: string) {
  return useQuery({
    queryKey: ['records', className, 'detail', id, fields ?? ''],
    queryFn: () => getRecord(className, id, fields),
    enabled: Boolean(className && id),
  });
}

export function useFieldOptions(className: string, attcode: string, enabled = true) {
  return useQuery({
    queryKey: ['meta', 'options', className, attcode],
    queryFn: () => getFieldOptions(className, attcode),
    enabled: enabled && Boolean(className && attcode),
    staleTime: 10 * 60_000,
  });
}

/** Writes invalidate only this class, so one edit does not refetch the rest. */
function useRecordMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>, className: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records', className] });
      queryClient.invalidateQueries({ queryKey: ['shell', 'nav-counts'] });
    },
  });
}

export function useCreateRecord(className: string) {
  return useRecordMutation(
    (fields: Record<string, unknown>) => createRecord(className, fields),
    className,
  );
}

export function useUpdateRecord(className: string, id: string) {
  return useRecordMutation(
    (fields: Record<string, unknown>) => updateRecord(className, id, fields),
    className,
  );
}
