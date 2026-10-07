import { env } from '@/config/env';
import { ApiError } from './ApiError';

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  query?: Query;
  body?: unknown;
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(
    path.startsWith('/') ? `${env.bffUrl}${path}` : path,
    // A relative VITE_BFF_URL (e.g. "/api") needs a base to parse against.
    window.location.origin,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { query, body, headers, ...init } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...init,
    });
  } catch (cause) {
    // Offline, DNS failure, CORS — status 0 marks "never reached the server".
    throw new ApiError('Could not reach the server. Check your connection.', 0, 'network_error', cause);
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    // The BFF nests its problem under `error`: { error: { code, message } }.
    // Reading the top level only would discard every server message and leave
    // the UI showing "Request failed (400)" for a precise, actionable reason.
    // The unwrapped shape is still accepted, so a plainer error source works too.
    type Problem = { message?: string; code?: string; details?: unknown };
    const body = (payload ?? {}) as Problem & { error?: Problem };
    const problem: Problem = body.error ?? body;

    throw new ApiError(
      problem.message ?? `Request failed (${response.status})`,
      response.status,
      problem.code,
      problem.details,
    );
  }

  return payload as T;
}

/**
 * The ONLY way the app talks to the BFF.
 *
 * Nothing here knows about iTop: the BFF owns that translation. Modules wrap
 * these calls in TanStack Query hooks inside their own `api/` folder — a React
 * component never calls `apiClient` directly.
 */
export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
