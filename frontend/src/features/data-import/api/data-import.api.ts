import { apiClient } from '@/lib/api-client';
import type {
  ImportClass,
  ImportPlan,
  ImportReport,
  ImportReportListItem,
  ImportRequest,
  SyncLog,
  SyncRunRequest,
  SyncRunResult,
  SyncSource,
  SyncSourceDetail,
  SyncSourceInput,
  UploadedTable,
} from '../types';

/** Raw BFF calls for data import and sync sources. Components use the hooks, never this file. */

const BASE = '/admin/data-import';

export const getImportClasses = () => apiClient.get<{ classes: ImportClass[] }>(`${BASE}/classes`);

/** The file travels base64-encoded; the BFF reads CSV and .xlsx alike. */
export const readFile = (fileName: string, content: string) =>
  apiClient.post<UploadedTable>(`${BASE}/read`, { fileName, content });

export const previewImport = (className: string, request: ImportRequest) =>
  apiClient.post<ImportPlan>(`${BASE}/${className}/preview`, request);
export const runImport = (className: string, request: ImportRequest) =>
  apiClient.post<ImportReport>(`${BASE}/${className}/run`, request);

export const getReports = () => apiClient.get<{ reports: ImportReportListItem[] }>(`${BASE}/reports`);
export const getReport = (id: string) => apiClient.get<ImportReport>(`${BASE}/reports/${id}`);
export const downloadReport = (id: string) => apiClient.getBlob(`${BASE}/reports/${id}/download`);

export const getSyncSources = () => apiClient.get<{ sources: SyncSource[] }>(`${BASE}/sync-sources`);
export const getSyncSource = (id: string) => apiClient.get<SyncSourceDetail>(`${BASE}/sync-sources/${id}`);
export const createSyncSource = (input: SyncSourceInput) =>
  apiClient.post<SyncSourceDetail>(`${BASE}/sync-sources`, input);
export const updateSyncSource = (id: string, input: SyncSourceInput) =>
  apiClient.put<SyncSourceDetail>(`${BASE}/sync-sources/${id}`, input);
export const deleteSyncSource = (id: string) => apiClient.delete<{ ok: true }>(`${BASE}/sync-sources/${id}`);
export const getSyncLog = (id: string, logId: number) =>
  apiClient.get<SyncLog>(`${BASE}/sync-sources/${id}/logs/${logId}`);
export const runSyncSource = (id: string, request: SyncRunRequest) =>
  apiClient.post<SyncRunResult>(`${BASE}/sync-sources/${id}/run`, request);
