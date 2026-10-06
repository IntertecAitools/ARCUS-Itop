import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { configureApiClient } from '@/lib/api-client';
import { i18n } from '@/lib/i18n';
import { toCurrentUser, tokenFor } from '@/mocks/handlers/utils';
import { useSessionStore } from '@/stores';

export type TestUser = 'admin' | 'agent' | null;

/** Sign a demo user in (admin = Problem Manager, agent = read-only) */
export function signIn(as: TestUser = 'admin'): void {
  if (!as) {
    useSessionStore.setState({ user: null, token: null, hydrated: true });
    return;
  }
  const id = as === 'admin' ? 'u1' : 'u2';
  useSessionStore.setState({ user: toCurrentUser(id), token: tokenFor(id), hydrated: true });
  configureApiClient({ getToken: () => useSessionStore.getState().token, onUnauthorized: () => {} });
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
}

/** Render inside Query + i18n providers, signed in as `user` */
export function renderWithProviders(ui: ReactElement, { user = 'admin', ...options }: RenderOptions & { user?: TestUser } = {}) {
  signIn(user);
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </I18nextProvider>
    );
  }
  return { user: userEvent.setup(), queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
