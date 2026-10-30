import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import type { TicketPriority } from '@/types/ticket';
import {
  cancelTicket,
  deleteDraft,
  deleteTime,
  getDraft,
  getHandling,
  getReport,
  getWorklog,
  listDrafts,
  logTime,
  markDuplicate,
  overridePriority,
  saveDraft,
  suggestDuplicates,
  suggestionsFor,
} from './ticket-handling.api';
import type { DraftKind, DuplicateQuery, HandledClass, TicketHandling, WorklogInput } from '../types';

export function useTicketHandling(cls: HandledClass, id: string) {
  return useQuery({
    queryKey: queryKeys.ticketHandling.summary(cls, id),
    queryFn: () => getHandling(cls, id),
    enabled: Boolean(id),
  });
}

/**
 * Overriding, marking a duplicate or cancelling changes the ticket itself:
 * its own screen, every list it is in, and the dashboard counts.
 */
function useTicketWrite<TInput>(cls: HandledClass, id: string, fn: (input: TInput) => Promise<TicketHandling>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (summary) => queryClient.setQueryData(queryKeys.ticketHandling.summary(cls, id), summary),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ticketHandling.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.navCounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() });
      if (cls === 'Incident') {
        queryClient.invalidateQueries({ queryKey: queryKeys.incidents.all() });
      } else {
        queryClient.invalidateQueries({ queryKey: ['records'] });
      }
    },
  });
}

export const useOverridePriority = (cls: HandledClass, id: string) =>
  useTicketWrite(cls, id, (input: { priority: TicketPriority; reason: string }) => overridePriority(cls, id, input));

export const useMarkDuplicate = (cls: HandledClass, id: string) =>
  useTicketWrite(cls, id, (input: { originalClass: HandledClass; originalId: number; note?: string }) =>
    markDuplicate(cls, id, input),
  );

export const useCancelTicket = (cls: HandledClass, id: string) =>
  useTicketWrite(cls, id, (reason: string) => cancelTicket(cls, id, reason));

/** Likely duplicates of an existing ticket, fetched when asked for. */
export function useSuggestionsFor(cls: HandledClass, id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.ticketHandling.suggestions({ cls, id }),
    queryFn: () => suggestionsFor(cls, id),
    enabled: enabled && Boolean(id),
  });
}

/** Likely duplicates of a ticket still being written; `null` asks nothing yet. */
export function useDuplicateSuggestions(query: DuplicateQuery | null) {
  return useQuery({
    queryKey: queryKeys.ticketHandling.suggestions(query ?? {}),
    queryFn: () => suggestDuplicates(query!),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useWorklog(cls: HandledClass, id: string) {
  return useQuery({ queryKey: queryKeys.ticketHandling.worklog(cls, id), queryFn: () => getWorklog(cls, id), enabled: Boolean(id) });
}

export function useLogTime(cls: HandledClass, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WorklogInput) => logTime(cls, id, input),
    onSuccess: (log) => queryClient.setQueryData(queryKeys.ticketHandling.worklog(cls, id), log),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.ticketHandling.all() }),
  });
}

export function useDeleteTime(cls: HandledClass, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: number) => deleteTime(entryId),
    onSuccess: (log) => queryClient.setQueryData(queryKeys.ticketHandling.worklog(cls, id), log),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.ticketHandling.all() }),
  });
}

export function useWorklogReport(query: { from?: string; to?: string; userId?: number }) {
  return useQuery({
    queryKey: queryKeys.ticketHandling.report(query),
    queryFn: () => getReport(query),
    placeholderData: keepPreviousData,
  });
}

export function useDrafts(kind?: DraftKind) {
  return useQuery({ queryKey: queryKeys.ticketHandling.drafts(kind), queryFn: () => listDrafts(kind) });
}

export function useDraft(id: string | null) {
  return useQuery({
    queryKey: queryKeys.ticketHandling.draft(id ?? ''),
    queryFn: () => getDraft(id!),
    enabled: Boolean(id),
    // Loaded once into the form; a refetch must not overwrite what is typed since.
    staleTime: Infinity,
  });
}

export function useSaveDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id?: string; kind: DraftKind; title?: string; data: Record<string, unknown> }) =>
      saveDraft(id, input),
    onSuccess: (draft) => {
      queryClient.setQueryData(queryKeys.ticketHandling.draft(draft.id), draft);
      queryClient.invalidateQueries({ queryKey: ['ticket-handling', 'drafts'] });
    },
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDraft(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ticket-handling', 'drafts'] }),
  });
}
