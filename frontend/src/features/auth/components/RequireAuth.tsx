import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SESSION_EXPIRED_EVENT } from '@/lib/api-client';
import { useSessionStore } from '@/stores/session.store';
import { SESSION_KEY, useSession } from '../hooks/useSession';
import type { SessionUser } from '../types';

/** The role line under the name: the most telling of the user's profiles. */
function roleOf(user: SessionUser) {
  if (user.isAdmin) return 'Administrator';
  return user.profiles.find((p) => p !== 'REST Services User') ?? 'User';
}

/**
 * Shows the app only to a signed-in user; everyone else goes to sign-in,
 * coming back to where they were heading afterwards.
 *
 * It also listens for the API client's "session expired" signal, so an idle
 * timeout mid-task lands on sign-in instead of a screen full of errors.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError } = useSession();
  const setUser = useSessionStore((s) => s.setUser);
  const queryClient = useQueryClient();
  const location = useLocation();

  useEffect(() => {
    setUser(
      user
        ? { id: String(user.id), login: user.login, name: user.name, email: user.email, role: roleOf(user), isAdmin: user.isAdmin }
        : null,
    );
  }, [user, setUser]);

  useEffect(() => {
    const expired = () => queryClient.setQueryData(SESSION_KEY, null);
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [queryClient]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-[13px] text-ink-muted">Loading…</div>;
  }
  if (isError) {
    return (
      <div role="alert" className="flex h-screen items-center justify-center text-[13px] text-critical-ink">
        The server could not be reached. Check that the backend is running, then reload.
      </div>
    );
  }
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  return <>{children}</>;
}
