import { vi } from 'vitest';

/** Mutable URL state behind the next/navigation mock */
export const navigationState = {
  pathname: '/',
  search: '',
  params: {} as Record<string, string>,
};

export const routerMock = {
  push: vi.fn((href: string) => setMockUrl(href)),
  replace: vi.fn((href: string) => setMockUrl(href)),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

/** Set the current URL, e.g. setMockUrl('/problems/12?tab=activity', { id: '12' }) */
export function setMockUrl(href: string, params: Record<string, string> = navigationState.params): void {
  const url = new URL(href, 'http://localhost');
  navigationState.pathname = url.pathname;
  navigationState.search = url.search.replace(/^\?/, '');
  navigationState.params = params;
}

export function resetNavigation(): void {
  setMockUrl('/', {});
  Object.values(routerMock).forEach((fn) => fn.mockClear());
}

export const nextNavigationMock = {
  useRouter: () => routerMock,
  usePathname: () => navigationState.pathname,
  useSearchParams: () => new URLSearchParams(navigationState.search),
  useParams: () => navigationState.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
};
