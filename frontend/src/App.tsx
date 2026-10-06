'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BootSplash } from '@/components/feedback';
import { AgentLayout, AuthLayout, PortalLayout } from './app/layouts';
import { AppProviders } from './app/providers';
import { RequireAuth, RequireRole, matchRoute } from './app/router';
import { enableMocking } from './main';

/** Picks the shell from the route table and applies the guards. */
function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const meta = matchRoute(pathname);

  if (meta.public) {
    return meta.layout === 'auth' ? <AuthLayout>{children}</AuthLayout> : <>{children}</>;
  }
  const Layout = meta.layout === 'portal' ? PortalLayout : AgentLayout;
  return (
    <RequireAuth>
      <Layout>
        <RequireRole permission={meta.permission}>{children}</RequireRole>
      </Layout>
    </RequireAuth>
  );
}

/**
 * Root client component: providers + app shell.
 * Renders only in the browser (after MSW is ready in mock mode), so server and
 * client markup always match and no page needs server data.
 */
export function App({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    enableMocking()
      .catch((error: unknown) => console.error('MSW failed to start', error))
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return <BootSplash />;

  return (
    <AppProviders>
      <Suspense fallback={<BootSplash />}>
        <Shell>{children}</Shell>
      </Suspense>
    </AppProviders>
  );
}
