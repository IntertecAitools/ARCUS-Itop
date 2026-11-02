import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { getAutoClose, runAutoClose, saveAutoClose } from './auto-close.api';
import type { AutoCloseDto, AutoCloseSettings } from '../types';

export function useAutoClose() {
  return useQuery({ queryKey: queryKeys.autoClose.settings(), queryFn: getAutoClose });
}

export function useSaveAutoClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AutoCloseSettings) => saveAutoClose(settings),
    onSuccess: (saved: AutoCloseDto) => queryClient.setQueryData(queryKeys.autoClose.settings(), saved),
  });
}

/** A check now; it closes tickets, so every ticket list may change. */
export function useRunAutoClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runAutoClose,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autoClose.settings() });
      queryClient.invalidateQueries({ queryKey: queryKeys.incidents.all() });
      queryClient.invalidateQueries({ queryKey: ['records'] });
    },
  });
}
