import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import '@/lib/i18n';
import { resetDb } from '@/mocks/fixtures/db';
import { server } from '@/mocks/node';
import { useSessionStore, useUiStore } from '@/stores';
import { resetNavigation } from './navigation';

vi.mock('next/navigation', async () => (await import('./navigation')).nextNavigationMock);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  window.localStorage.clear();
  resetDb();
  resetNavigation();
  useSessionStore.setState({ user: null, token: null, hydrated: true });
  useUiStore.setState({ toasts: [], mobileNavOpen: false });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
