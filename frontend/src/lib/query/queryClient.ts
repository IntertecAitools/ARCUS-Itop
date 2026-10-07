import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // An ITSM console is read-heavy and re-focused constantly; 30s keeps it
        // feeling live without hammering the BFF on every tab switch.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Never retry a 4xx — the request itself is wrong, repeating it won't help.
          if (error instanceof ApiError && !error.isRetryable) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
