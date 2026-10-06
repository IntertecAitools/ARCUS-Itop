import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/api-client';

export interface QueryErrorHandlers {
  /** Called for every failed mutation and for failed queries that are not 404s */
  onError: (error: unknown) => void;
}

export function makeQueryClient({ onError }: QueryErrorHandlers): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // 404s are rendered as not-found states by the page, not toasted.
        if (isApiError(error) && error.status === 404) return;
        if (query.meta?.silent) return;
        onError(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.silent) return;
        onError(error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(isApiError(error) && error.status >= 400 && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}
