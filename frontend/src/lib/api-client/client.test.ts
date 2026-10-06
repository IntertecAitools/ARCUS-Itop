import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/node';
import { signIn } from '@/test/render';
import { apiClient, buildUrl } from './client';
import { ApiError, isNotFound } from './errors';

describe('buildUrl', () => {
  it('prefixes the BFF base and drops empty query values', () => {
    const url = new URL(buildUrl('/problems', { q: 'vpn', orgId: undefined, status: ['new', 'assigned'], page: 2, empty: '' }));
    expect(url.pathname).toBe('/api/bff/problems');
    expect(url.searchParams.get('q')).toBe('vpn');
    expect(url.searchParams.get('status')).toBe('new,assigned');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('orgId')).toBe(false);
    expect(url.searchParams.has('empty')).toBe(false);
  });

  it('omits empty arrays', () => {
    expect(new URL(buildUrl('/problems', { status: [] })).searchParams.has('status')).toBe(false);
  });
});

describe('apiClient', () => {
  it('returns parsed JSON', async () => {
    const page = await apiClient.get<{ total: number }>('/problems', { query: { pageSize: 5 } });
    expect(page.total).toBeGreaterThan(0);
  });

  it('throws ApiError with the BFF code and message', async () => {
    const promise = apiClient.get('/problems/999999');
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(isNotFound(await promise.catch((e: unknown) => e))).toBe(true);
  });

  it('sends the session token', async () => {
    signIn('admin');
    let auth: string | null = null;
    server.use(
      http.get('*/api/bff/echo', ({ request }) => {
        auth = request.headers.get('Authorization');
        return HttpResponse.json({});
      }),
    );
    await apiClient.get('/echo');
    expect(auth).toBe('Bearer mock-token-u1');
  });

  it('maps network failures to a network_error ApiError', async () => {
    server.use(http.get('*/api/bff/down', () => HttpResponse.error()));
    await expect(apiClient.get('/down')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('falls back to http_<status> when the body is not JSON', async () => {
    server.use(http.get('*/api/bff/broken', () => new HttpResponse('oops', { status: 500 })));
    await expect(apiClient.get('/broken')).rejects.toMatchObject({ status: 500, code: 'http_500' });
  });
});
