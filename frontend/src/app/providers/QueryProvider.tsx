'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { i18n } from '@/lib/i18n';
import { makeQueryClient } from '@/lib/query';
import { toast } from '@/stores';

/** TanStack Query client; every failed request surfaces as a global toast. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    makeQueryClient({
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(i18n.t('errors.requestFailed'), message);
      },
    }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
