import { apiClient } from '@/lib/api-client';
import type { SessionUser } from '../types';

/** Sign-in against the platform. The BFF checks the account with iTop. */
export const signIn = (login: string, password: string) =>
  apiClient.post<{ user: SessionUser }>('/auth/login', { login, password });

export const signOut = () => apiClient.post<null>('/auth/logout');

/** The signed-in user, or a 401 when there is none. */
export const getSession = () => apiClient.get<{ user: SessionUser }>('/auth/me');

export const changePassword = (current: string, next: string) =>
  apiClient.post<{ ok: true }>('/auth/password', { current, next });

/** What the sign-in page may offer before anyone is signed in. */
export const getAuthOptions = () => apiClient.get<{ passwordReset: boolean }>('/auth/options');

/** Asks for a reset link. The answer is the same whether or not the account exists. */
export const requestPasswordReset = (identifier: string) =>
  apiClient.post<{ ok: true; message: string }>('/auth/forgot-password', { identifier });

export const resetPassword = (token: string, password: string) =>
  apiClient.post<{ ok: true }>('/auth/reset-password', { token, password });
