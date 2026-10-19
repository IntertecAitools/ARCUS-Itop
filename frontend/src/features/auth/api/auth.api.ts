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
