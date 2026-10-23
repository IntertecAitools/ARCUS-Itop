import { apiClient } from '@/lib/api-client';
import { env } from '@/config/env';
import type { AuthOptions, MfaEnrolment, SessionUser, SignInResult } from '../types';

/**
 * Sign-in against the platform. The BFF checks the account with iTop; staff
 * (and anyone enrolled) then answer an authenticator code at /auth/mfa/*.
 */
export const signIn = (login: string, password: string) =>
  apiClient.post<SignInResult>('/auth/login', { login, password });

export const signOut = () => apiClient.post<null>('/auth/logout');

/** The signed-in user, or a 401 when there is none (with `details.mfa` while a code is awaited). */
export const getSession = () => apiClient.get<{ user: SessionUser }>('/auth/me');

export const changePassword = (current: string, next: string) =>
  apiClient.post<{ ok: true }>('/auth/password', { current, next });

/** What the sign-in page may offer before anyone is signed in. */
export const getAuthOptions = () => apiClient.get<AuthOptions>('/auth/options');

/** Asks for a reset link. The answer is the same whether or not the account exists. */
export const requestPasswordReset = (identifier: string) =>
  apiClient.post<{ ok: true; message: string }>('/auth/forgot-password', { identifier });

export const resetPassword = (token: string, password: string) =>
  apiClient.post<{ ok: true }>('/auth/reset-password', { token, password });

/** The second step of sign-in: an authenticator code, or one of the recovery codes. */
export const verifyMfa = (input: { code: string } | { recoveryCode: string }) =>
  apiClient.post<{ user: SessionUser }>('/auth/mfa/verify', input);

/** The authenticator to set up (the same one until it is confirmed). */
export const getMfaEnrolment = () => apiClient.get<MfaEnrolment>('/auth/mfa/enrol');

/** Confirms the set-up with a first code; answers the recovery codes, shown this once. */
export const confirmMfaEnrolment = (code: string) =>
  apiClient.post<{ user: SessionUser; recoveryCodes: string[] }>('/auth/mfa/enrol', { code });

/**
 * Single sign-on is a page navigation, not an API call: the BFF sends the
 * browser to the identity provider and back.
 */
export const ssoStartUrl = (next: string) => `${env.bffUrl}/auth/sso/start?returnTo=${encodeURIComponent(next)}`;
