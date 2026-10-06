import type { CurrentUser } from '@/types';

export type { CurrentUser };

export interface LoginRequest {
  login: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: CurrentUser;
}

/** Write permissions checked by RequireRole and by pages before showing actions */
export type Permission = 'problem:write' | 'knownerror:write';
