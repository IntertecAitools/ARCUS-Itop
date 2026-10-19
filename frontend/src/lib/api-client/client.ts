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

  // FormData carries its own encoding and a generated multipart boundary, so
  // it must be passed through untouched: serialising it would send the string
  // "[object FormData]", and setting Content-Type ourselves would omit the
  // boundary and make the body unparseable.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: isForm ? (body as BodyInit) : JSON.stringify(body) } : {}),
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
 * Binary and multipart, for files.
 *
 * Separate from `request` because that one assumes JSON in both directions.
 * The important part is that files go through here too: a download served by
 * pointing the browser at the backend would leak its address and bypass the
 * BFF, and an upload sent as base64 JSON would inflate every file by a third.
 */
async function requestBinary(
  method: string,
  path: string,
  options: { body?: BodyInit; query?: Query } = {},
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: 'include',
      // No Content-Type: the browser sets it, with the multipart boundary.
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
  } catch (cause) {
    throw new ApiError('Could not reach the server. Check your connection.', 0, 'network_error', cause);
  }

  if (!response.ok) {
    // Errors stay JSON even when success is binary, so the BFF's message
    // survives instead of the user seeing "Request failed (413)".
    type Problem = { message?: string; code?: string; details?: unknown };
    const payload = (await response.json().catch(() => null)) as
      | (Problem & { error?: Problem })
      | null;
    const problem: Problem = payload?.error ?? payload ?? {};
    throw new ApiError(
      problem.message ?? `Request failed (${response.status})`,
      response.status,
      problem.code,
      problem.details,
    );
  }

  return response.blob();
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
  /** Fetches a file. The caller decides what to do with the bytes. */
  getBlob: (path: string, query?: Query) => requestBinary('GET', path, { query }),
  /** Uploads multipart/form-data and reads the JSON result back. */
  postForm: <T>(path: string, form: FormData) => request<T>('POST', path, { body: form }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
