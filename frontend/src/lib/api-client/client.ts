import { env } from '@/config/env';
import type { ApiErrorBody } from '@/types';
import { ApiError } from './errors';

type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

let getToken: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

/** Called once by the Auth provider so requests carry the session token. */
export function configureApiClient(options: { getToken: () => string | null; onUnauthorized: () => void }): void {
  getToken = options.getToken;
  onUnauthorized = options.onUnauthorized;
}

export function buildUrl(path: string, query?: QueryParams): string {
  const base = env.bffUrl.replace(/\/$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = /^https?:\/\//.test(base) ? new URL(base + path) : new URL(base + path, origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        if (value.length > 0) url.searchParams.set(key, value.join(','));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: 'include',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'The server could not be reached. Check your connection and try again.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? parseJson(text) : undefined;

  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    throw ApiError.fromBody(
      response.status,
      data as Partial<ApiErrorBody> | undefined,
      response.statusText || 'The request failed.',
    );
  }
  return data as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  delete: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
