'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BootSplash } from '@/components/feedback';
import { routes } from '@/config/routes';
import { useCurrentUser } from '@/features/auth';
import { useSessionStore } from '@/stores';

/** Redirects to /login?next=… when there is no session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const hydrated = useSessionStore((s) => s.hydrated);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (hydrated && !user) router.replace(routes.login(search ? `${pathname}?${search}` : pathname));
  }, [hydrated, user, router, pathname, search]);

  if (!hydrated || !user) return <BootSplash />;
  return <>{children}</>;
}
