import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import {
  changePassword,
  confirmMfaEnrolment,
  getMfaEnrolment,
  getSession,
  signIn,
  signOut,
  verifyMfa,
} from '../api/auth.api';
import type { MfaStep, SessionUser } from '../types';

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

/** Starts the session in the cache once the BFF says who signed in. */
function useSignedIn() {
  const queryClient = useQueryClient();
  return (user: SessionUser) => {
    // A different user may be signing in: nothing cached for the last one
    // (their records, their counts) may be shown to this one.
    queryClient.clear();
    queryClient.setQueryData(SESSION_KEY, user);
  };
}

/** Password sign-in. Resolves to the MFA step when an authenticator code is needed first. */
export function useSignIn() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: ({ login, password }: { login: string; password: string }) => signIn(login, password),
    onSuccess: (result) => {
      if ('user' in result) signedIn(result.user);
    },
  });
}

/**
 * A sign-in waiting for its authenticator code, e.g. after single sign-on
 * redirected back to the sign-in page: /auth/me says which step.
 */
export function usePendingMfa() {
  return useQuery({
    queryKey: ['auth', 'mfa-pending'],
    queryFn: async (): Promise<MfaStep | null> => {
      try {
        await getSession();
        return null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const step = (error.details as { mfa?: { step?: MfaStep } } | undefined)?.mfa?.step;
          return step ?? null;
        }
        throw error;
      }
    },
    retry: false,
  });
}

export function useVerifyMfa() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: verifyMfa,
    onSuccess: ({ user }) => signedIn(user),
  });
}

export function useMfaEnrolment(enabled: boolean) {
  return useQuery({ queryKey: ['auth', 'mfa-enrolment'], queryFn: getMfaEnrolment, enabled, retry: false, staleTime: Infinity });
}

/**
 * Confirms a new authenticator. The session starts only once the recovery
 * codes have been seen: `finish` puts the user in the cache.
 */
export function useConfirmMfaEnrolment() {
  const signedIn = useSignedIn();
  const mutation = useMutation({ mutationFn: confirmMfaEnrolment });
  const finish = () => {
    if (mutation.data) signedIn(mutation.data.user);
  };
  return { ...mutation, finish };
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
