import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addLink,
  applyStimulus,
  createRecord,
  deleteRecord,
  exportRecords,
  getClassInfo,
  getClasses,
  getFieldOptions,
  getBulkDeletePlan,
  getHistory,
  getImpact,
  getRecord,
  getRelated,
  importRecords,
  listRecords,
  removeLink,
  runBulk,
  searchOptions,
  updateRecord,
} from './records.api';
import type { BulkRequest, Criterion, ExportFormat, ImportRequest, RecordFilters } from '../types';

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

/**
 * Writes invalidate only this class, so one edit does not refetch the rest.
 *
 * Generic over the result as well as the arguments: a create needs the new
 * record's id in order to navigate to it, and an `unknown` result would push a
 * cast onto every caller.
 */
function useRecordMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  className: string,
) {
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

/** Related objects for one LinkedSet attribute. */
export function useRelated(className: string, id: string, attcode: string, fields?: string) {
  return useQuery({
    queryKey: ['records', className, 'links', id, attcode, fields],
    queryFn: () => getRelated(className, id, attcode, fields),
    enabled: Boolean(className && id && attcode),
  });
}

/**
 * Lifecycle actions. Invalidates the record so the new state is shown.
 *
 * `fields` carries what the target state demands (a solution on resolve, an
 * agent on assign); iTop refuses the action without them.
 */
export function useApplyStimulus(className: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ stimulus, fields }: { stimulus: string; fields?: Record<string, unknown> }) =>
      applyStimulus(className, id, stimulus, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records', className] });
      queryClient.invalidateQueries({ queryKey: ['shell', 'nav-counts'] });
    },
  });
}

/** The deletion plan iTop would follow, without deleting anything. */
export function useDeletePlan(className: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['records', className, 'delete-plan', id],
    queryFn: () => deleteRecord(className, id, true),
    enabled: enabled && Boolean(className && id),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDeleteRecord(className: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteRecord(className, id, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records', className] });
      queryClient.invalidateQueries({ queryKey: ['shell', 'nav-counts'] });
    },
  });
}

export function useHistory(className: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['records', className, 'history', id],
    queryFn: () => getHistory(className, id),
    enabled: enabled && Boolean(className && id),
  });
}

/** Add to / remove from a related set; refreshes the tab and the record. */
export function useLinkMutations(className: string, id: string, attcode: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['records', className] });
  return {
    add: useMutation({
      mutationFn: (targetId: number) => addLink(className, id, attcode, targetId),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (itemId: number) => removeLink(className, id, attcode, itemId),
      onSuccess,
    }),
  };
}

export function useOptionSearch(
  target: { className: string; attcode?: string } | null,
  q: string,
) {
  return useQuery({
    queryKey: ['records', 'option-search', target?.className, target?.attcode, q],
    queryFn: () => searchOptions(target!, q),
    enabled: Boolean(target),
    staleTime: 30_000,
  });
}

export function useBulk(className: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: BulkRequest) => runBulk(className, request),
    // Even a partly failed run changed records, so always refresh.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['records', className] });
      queryClient.invalidateQueries({ queryKey: ['shell', 'nav-counts'] });
    },
  });
}

export function useBulkDeletePlan(className: string, ids: number[], enabled: boolean) {
  return useQuery({
    queryKey: ['records', className, 'bulk-delete-plan', ids],
    queryFn: () => getBulkDeletePlan(className, ids),
    enabled: enabled && ids.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
}

/** Downloads a list as CSV / Excel / PDF and hands it to the browser's save flow. */
export function useExport(className: string) {
  return useMutation({
    mutationFn: async ({
      format,
      ...filters
    }: {
      format: ExportFormat;
      q?: string;
      view?: string;
      criteria?: Criterion[];
      /** iTop's `fields`: the columns to export, comma-separated. */
      fields?: string;
    }) => {
      saveBlob(await exportRecords(className, format, filters), `${className}-${new Date().toISOString().slice(0, 10)}.${format}`);
    },
  });
}

/** Hands a downloaded file to the browser's save flow. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Revoking at once can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function useImport(className: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ImportRequest) => importRecords(className, request),
    onSuccess: (report) => {
      if (!report.simulated) queryClient.invalidateQueries({ queryKey: ['records', className] });
    },
  });
}

export function useImpact(className: string, id: string, direction: 'up' | 'down', depth: number) {
  return useQuery({
    queryKey: ['records', className, 'impact', id, direction, depth],
    queryFn: () => getImpact(className, id, direction, depth),
    enabled: Boolean(className && id),
  });
}
