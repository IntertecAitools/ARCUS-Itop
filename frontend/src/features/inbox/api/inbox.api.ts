import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { InboxList } from '../types';

const KEY = ['me', 'notifications'] as const;

/** The unread count for the badge: polled, and refreshed when the tab regains focus. */
export function useUnreadCount() {
  return useQuery({
    queryKey: [...KEY, 'count'],
    queryFn: async () => (await apiClient.get<{ unread: number }>('/me/notifications/count')).unread,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // A failed poll is not worth an error on screen; the next one will tell.
    retry: false,
  });
}

export function useInbox(enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'list'],
    queryFn: () => apiClient.get<InboxList>('/me/notifications', { query: { limit: 20 } }),
    enabled,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

export function useMarkRead() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: number) => apiClient.post<null>(`/me/notifications/${id}/read`),
    onSuccess: refresh,
  });
}

export function useMarkAllRead() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => apiClient.post<{ marked: number }>('/me/notifications/read-all'),
    onSuccess: refresh,
  });
}
