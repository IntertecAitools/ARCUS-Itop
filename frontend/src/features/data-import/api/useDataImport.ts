import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  createSyncSource,
  deleteSyncSource,
  getImportClasses,
  getReport,
  getReports,
  getSyncLog,
  getSyncSource,
  getSyncSources,
  previewImport,
  readFile,
  runImport,
  runSyncSource,
  updateSyncSource,
} from './data-import.api';
import type { ImportRequest, SyncRunRequest, SyncSourceInput } from '../types';

export function useImportClasses() {
  return useQuery({ queryKey: queryKeys.dataImport.classes(), queryFn: getImportClasses, staleTime: 30 * 60_000 });
}

export const useReadFile = () =>
  useMutation({ mutationFn: ({ fileName, content }: { fileName: string; content: string }) => readFile(fileName, content) });

export const usePreviewImport = () =>
  useMutation({
    mutationFn: ({ className, request }: { className: string; request: ImportRequest }) =>
      previewImport(className, request),
  });

export function useRunImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ className, request }: { className: string; request: ImportRequest }) => runImport(className, request),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dataImport.reports() });
      queryClient.invalidateQueries({ queryKey: ['records', report.className] });
    },
  });
}

export function useImportReports() {
  return useQuery({ queryKey: queryKeys.dataImport.reports(), queryFn: getReports });
}

export function useImportReport(id: string | null) {
  return useQuery({
    queryKey: queryKeys.dataImport.report(id ?? ''),
    queryFn: () => getReport(id!),
    enabled: Boolean(id),
  });
}

export function useSyncSources() {
  return useQuery({ queryKey: queryKeys.dataImport.sources(), queryFn: getSyncSources });
}

export function useSyncSource(id: string) {
  return useQuery({ queryKey: queryKeys.dataImport.source(id), queryFn: () => getSyncSource(id), enabled: Boolean(id) });
}

export function useSyncLog(id: string, logId: number | null) {
  return useQuery({
    queryKey: queryKeys.dataImport.log(id, logId ?? 0),
    queryFn: () => getSyncLog(id, logId!),
    enabled: Boolean(id && logId),
  });
}

/** Writes to sources reload the list and every source's detail. */
function useSourceWrite<T, R>(run: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.dataImport.sources() }),
  });
}

export const useSaveSyncSource = () =>
  useSourceWrite(({ id, input }: { id?: string; input: SyncSourceInput }) =>
    id ? updateSyncSource(id, input) : createSyncSource(input),
  );
export const useDeleteSyncSource = () => useSourceWrite((id: string) => deleteSyncSource(id));
export const useRunSyncSource = () =>
  useSourceWrite(({ id, request }: { id: string; request: SyncRunRequest }) => runSyncSource(id, request));
