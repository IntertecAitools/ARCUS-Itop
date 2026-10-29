import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  CatalogService,
  Faq,
  NewRequest,
  PortalProfile,
  PortalTicketDetail,
  PortalTicketList,
} from '../types';

/** The self-service API: the BFF scopes every call to the signed-in end user. */
const base = '/portal';

export function useMyRequests(state: 'open' | 'closed', page: number, q: string) {
  return useQuery({
    queryKey: ['portal', 'requests', state, page, q],
    queryFn: () =>
      apiClient.get<PortalTicketList>(`${base}/requests`, { query: { state, page, q: q || undefined } }),
    placeholderData: (previous) => previous,
  });
}

export function useMyRequest(id: string) {
  return useQuery({
    queryKey: ['portal', 'request', id],
    queryFn: () => apiClient.get<PortalTicketDetail>(`${base}/requests/${id}`),
    enabled: Boolean(id),
  });
}

/** Writes on one request; each answers with the updated request. */
export function useRequestActions(id: string) {
  const queryClient = useQueryClient();
  const onSuccess = (detail: PortalTicketDetail) => {
    queryClient.setQueryData(['portal', 'request', id], detail);
    queryClient.invalidateQueries({ queryKey: ['portal', 'requests'] });
  };
  return {
    comment: useMutation({
      mutationFn: (message: string) =>
        apiClient.post<PortalTicketDetail>(`${base}/requests/${id}/comments`, { message }),
      onSuccess,
    }),
    close: useMutation({
      mutationFn: (input: { satisfaction?: string; comment?: string }) =>
        apiClient.post<PortalTicketDetail>(`${base}/requests/${id}/close`, input),
      onSuccess,
    }),
    reopen: useMutation({
      mutationFn: (message: string) =>
        apiClient.post<PortalTicketDetail>(`${base}/requests/${id}/reopen`, { message }),
      onSuccess,
    }),
  };
}

export function useCreateRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewRequest) => apiClient.post<PortalTicketDetail>(`${base}/requests`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'requests'] }),
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ['portal', 'catalog'],
    queryFn: async () => (await apiClient.get<{ services: CatalogService[] }>(`${base}/catalog`)).services,
    staleTime: 10 * 60_000,
  });
}

export function useFaqs(q: string) {
  return useQuery({
    queryKey: ['portal', 'faqs', q],
    queryFn: async () => (await apiClient.get<{ items: Faq[] }>(`${base}/faqs`, { query: { q: q || undefined } })).items,
    placeholderData: (previous) => previous,
  });
}

export function useFaq(id: string) {
  return useQuery({
    queryKey: ['portal', 'faq', id],
    queryFn: () => apiClient.get<Faq>(`${base}/faqs/${id}`),
    enabled: Boolean(id),
  });
}

/** "Was this helpful?" on an article. */
export function useRateFaq(id: string) {
  return useMutation({
    mutationFn: (input: { helpful: boolean; comment: string }) => apiClient.post(`${base}/faqs/${id}/feedback`, input),
  });
}

export function useProfile() {
  return useQuery({ queryKey: ['portal', 'profile'], queryFn: () => apiClient.get<PortalProfile>(`${base}/profile`) });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { phone?: string; mobilePhone?: string }) =>
      apiClient.patch<PortalProfile>(`${base}/profile`, input),
    onSuccess: (profile) => queryClient.setQueryData(['portal', 'profile'], profile),
  });
}
