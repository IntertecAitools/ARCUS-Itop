import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores';
import type { LoginRequest, LoginResponse } from '../types';

export function useLogin() {
  const signIn = useSessionStore((s) => s.signIn);
  return useMutation({
    mutationFn: (body: LoginRequest) => apiClient.post<LoginResponse>('/auth/login', body),
    onSuccess: ({ user, token }) => signIn(user, token),
    // The login form shows the error inline instead of a toast.
    meta: { silent: true },
  });
}

export function useSignOut() {
  const signOut = useSessionStore((s) => s.signOut);
  const queryClient = useQueryClient();
  return async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // signing out locally is enough if the BFF is unreachable
    }
    signOut();
    queryClient.clear();
  };
}
