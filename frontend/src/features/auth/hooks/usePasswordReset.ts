import { useMutation, useQuery } from '@tanstack/react-query';
import { getAuthOptions, requestPasswordReset, resetPassword } from '../api/auth.api';

/** Whether "Forgot password?" is available (it needs a mail server on the BFF). */
export function useAuthOptions() {
  return useQuery({
    queryKey: ['auth', 'options'],
    queryFn: getAuthOptions,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRequestPasswordReset() {
  return useMutation({ mutationFn: (identifier: string) => requestPasswordReset(identifier) });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      resetPassword(token, password),
  });
}
