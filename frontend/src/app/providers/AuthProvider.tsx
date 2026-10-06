'use client';

import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { configureApiClient } from '@/lib/api-client';
import { useSessionStore } from '@/stores';

/** Wires the session token into the API client; a 401 ends the session. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Configured during the first render (not in an effect) so the very first
  // queries of child components already carry the token.
  useState(() =>
    configureApiClient({
      getToken: () => useSessionStore.getState().token,
      onUnauthorized: () => {
        useSessionStore.getState().signOut();
        queryClient.clear();
      },
    }),
  );

  return <>{children}</>;
}
