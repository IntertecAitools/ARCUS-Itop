import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Logo } from '@/components/layout';
import { cn } from '@/lib/utils';
import { env } from '@/config/env';
import { useSessionStore } from '@/stores/session.store';
import { useSignOut } from '@/features/auth';
import { NotificationBell } from '@/features/inbox';

const LINKS = [
  { to: '/portal', label: 'Home', end: true },
  { to: '/portal/requests', label: 'My requests', end: false },
  { to: '/portal/new', label: 'New request', end: false },
  { to: '/portal/help', label: 'Knowledge base', end: false },
  { to: '/portal/profile', label: 'My profile', end: false },
];

/**
 * The self-service portal's frame: deliberately simpler than the agent shell.
 * End users raise and follow their own requests and read the knowledge base;
 * nothing here exposes the agent screens.
 */
export function PortalLayout() {
  const user = useSessionStore((s) => s.user);
  const clear = useSessionStore((s) => s.clear);
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo collapsed />
            <span className="text-[15px] font-semibold text-ink">
              {env.appName} {env.platformName}
            </span>
          </div>
          <nav aria-label="Portal" className="flex flex-1 flex-wrap gap-1">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-control px-3 py-1.5 text-[13px] transition-colors',
                    isActive ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-[13px]">
            {/* End users only reach their own requests here. */}
            <NotificationBell linkFor={(r) => (r.type === 'UserRequest' ? `/portal/requests/${r.id}` : null)} />
            <span className="text-ink">{user?.name}</span>
            <button
              type="button"
              disabled={signOut.isPending}
              onClick={() =>
                signOut.mutate(undefined, {
                  onSettled: () => {
                    clear();
                    navigate('/login', { replace: true });
                  },
                })
              }
              className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-critical-ink hover:bg-surface-hover"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
