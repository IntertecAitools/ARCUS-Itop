import { apiClient } from '@/lib/api-client';
import type {
  Draft,
  DraftKind,
  DraftSummary,
  DuplicateCandidate,
  DuplicateQuery,
  HandledClass,
  TicketHandling,
  TicketWorklog,
  WorklogInput,
  WorklogReport,
} from '../types';
import type { TicketPriority } from '@/types/ticket';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

const base = (cls: HandledClass, id: string | number) => `/ticket-handling/${cls}/${id}`;

export const getHandling = (cls: HandledClass, id: string) => apiClient.get<TicketHandling>(base(cls, id));

export const overridePriority = (cls: HandledClass, id: string, input: { priority: TicketPriority; reason: string }) =>
  apiClient.put<TicketHandling>(`${base(cls, id)}/priority`, input);

export const markDuplicate = (
  cls: HandledClass,
  id: string,
  input: { originalClass: HandledClass; originalId: number; note?: string },
) => apiClient.post<TicketHandling>(`${base(cls, id)}/duplicate`, input);

export const cancelTicket = (cls: HandledClass, id: string, reason: string) =>
  apiClient.post<TicketHandling>(`${base(cls, id)}/cancel`, { reason });

export const suggestionsFor = (cls: HandledClass, id: string) =>
  apiClient.get<{ items: DuplicateCandidate[] }>(`${base(cls, id)}/duplicates/suggestions`);

export const suggestDuplicates = (query: DuplicateQuery) =>
  apiClient.post<{ items: DuplicateCandidate[] }>('/ticket-handling/duplicates/suggest', query);

export const getWorklog = (cls: HandledClass, id: string) => apiClient.get<TicketWorklog>(`${base(cls, id)}/worklogs`);

export const logTime = (cls: HandledClass, id: string, input: WorklogInput) =>
  apiClient.post<TicketWorklog>(`${base(cls, id)}/worklogs`, input);

export const deleteTime = (entryId: number) => apiClient.delete<TicketWorklog>(`/ticket-handling/worklogs/${entryId}`);

export const getReport = (query: { from?: string; to?: string; userId?: number }) =>
  apiClient.get<WorklogReport>('/ticket-handling/worklogs/report', { query });

export const listDrafts = (kind?: DraftKind) =>
  apiClient.get<{ items: DraftSummary[] }>('/me/drafts', kind ? { query: { kind } } : undefined);

export const getDraft = (id: string) => apiClient.get<Draft>(`/me/drafts/${id}`);

export const saveDraft = (id: string | undefined, input: { kind: DraftKind; title?: string; data: Record<string, unknown> }) =>
  id ? apiClient.put<Draft>(`/me/drafts/${id}`, input) : apiClient.post<Draft>('/me/drafts', input);

export const deleteDraft = (id: string) => apiClient.delete<null>(`/me/drafts/${id}`);
