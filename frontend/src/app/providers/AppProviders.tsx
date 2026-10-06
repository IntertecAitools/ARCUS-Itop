import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query/queryClient';
import { ThemeProvider } from './ThemeProvider';

/**
 * Every cross-cutting provider, in one place and in a deliberate order.
 * Add new ones here (i18n, auth, toasts) rather than wrapping <App/> again.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  // One client per mount — created in state so StrictMode's double-invoke and
  // fast refresh don't silently throw away the cache.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
