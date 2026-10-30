import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query/queryClient';
import { ThemeProvider } from './ThemeProvider';
import { BrandingProvider } from '@/features/branding';
import { useAccountLanguage } from '@/features/auth';

/** The signed-in user's saved language, applied on any device they sign in from. */
function AccountLanguage() {
  useAccountLanguage();
  return null;
}

/**
 * Every cross-cutting provider, in one place and in a deliberate order.
 * Add new ones here (auth, toasts) rather than wrapping <App/> again.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  // One client per mount — created in state so StrictMode's double-invoke and
  // fast refresh don't silently throw away the cache.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrandingProvider>
          <AccountLanguage />
          {children}
        </BrandingProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
