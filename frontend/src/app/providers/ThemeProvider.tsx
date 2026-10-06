'use client';

import { useEffect, type ReactNode } from 'react';

/** IRAOPS ships one light theme; the provider is the hook point for future themes. */
export function ThemeProvider({ theme = 'light', children }: { theme?: 'light'; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <>{children}</>;
}
