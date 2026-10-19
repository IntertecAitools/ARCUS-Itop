import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { changePassword, getSession, signIn, signOut } from '../api/auth.api';

export const SESSION_KEY = ['auth', 'me'] as const;

/**
 * The current session. A 401 is an answer here ("nobody is signed in"), not
 * an error to retry, so it resolves to `null`.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return (await getSession()).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ login, password }: { login: string; password: string }) => signIn(login, password),
    onSuccess: ({ user }) => {
      // A different user may be signing in: nothing cached for the last one
      // (their records, their counts) may be shown to this one.
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, user);
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, null);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => changePassword(current, next),
  });
}
