import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { CreateUserInput, Option, Profile, UpdateUserInput, UserDetail, UserList } from '../types';

const base = '/admin/users';

export function useUsers(page: number, q: string) {
  return useQuery({
    queryKey: ['admin', 'users', page, q],
    queryFn: () => apiClient.get<UserList>(base, { query: { page, q: q || undefined } }),
    placeholderData: (previous) => previous,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['admin', 'users', 'one', id],
    queryFn: () => apiClient.get<UserDetail>(`${base}/${id}`),
    enabled: Boolean(id),
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ['admin', 'profiles'],
    queryFn: async () => (await apiClient.get<{ profiles: Profile[] }>('/admin/profiles')).profiles,
    staleTime: 10 * 60_000,
  });
}

/** Search people or organisations by name, for the account form's pickers. */
export function useLookup(className: 'Person' | 'Organization', q: string) {
  return useQuery({
    queryKey: ['admin', 'lookup', className, q],
    queryFn: async () =>
      (await apiClient.get<{ options: Option[] }>(`/lookups/${className}`, { query: { q: q || undefined, limit: 20 } }))
        .options,
    staleTime: 30_000,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => apiClient.post<UserDetail>(base, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) => apiClient.patch<UserDetail>(`${base}/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useSetPassword(id: string) {
  return useMutation({
    mutationFn: (password: string) => apiClient.post<{ ok: true }>(`${base}/${id}/password`, { password }),
  });
}
