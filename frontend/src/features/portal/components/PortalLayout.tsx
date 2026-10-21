import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { Logo } from '@/components/layout';
import { PublicTheme, PublicThemeToggle, SkipLink } from '@/components/public';
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
 * The self-service portal's frame: deliberately simpler than the agent shell,
 * and in the public look (see components/public). End users raise and follow
 * their own requests and read the knowledge base; nothing here exposes the
 * agent screens.
 */
export function PortalLayout() {
  const user = useSessionStore((s) => s.user);
  const clear = useSessionStore((s) => s.clear);
  const signOut = useSignOut();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // A link in the phone menu was followed: fold the menu away.
  useEffect(() => setMenuOpen(false), [pathname]);

  const doSignOut = () =>
    signOut.mutate(undefined, {
      onSettled: () => {
        clear();
        navigate('/login', { replace: true });
      },
    });

  const links = (variant: 'bar' | 'menu') =>
    LINKS.map((link) => (
      <NavLink
        key={link.to}
        to={link.to}
        end={link.end}
        className={({ isActive }) =>
          cn(
            'text-[14px] transition-colors',
            variant === 'bar'
              ? 'flex h-16 items-center border-b-2'
              : 'block border-s-2 py-2.5 ps-4',
            isActive ? 'border-ink text-ink' : 'border-transparent text-ink-secondary hover:text-ink',
          )
        }
      >
        {link.label}
      </NavLink>
    ));

  return (
    <PublicTheme className="flex flex-col">
      <SkipLink />
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5 sm:px-8">
          <Link to="/portal" className="flex items-center gap-3" aria-label={`${env.appName} ${env.platformName}`}>
            <Logo collapsed />
            <span className="hidden text-[15px] font-medium tracking-tight text-ink sm:inline">
              {env.appName} {env.platformName}
            </span>
          </Link>
          <nav aria-label="Portal" className="hidden flex-1 gap-7 lg:flex">
            {links('bar')}
          </nav>
          <div className="ms-auto flex items-center gap-1 text-[13px] lg:ms-0">
            <PublicThemeToggle />
            {/* End users only reach their own requests here. */}
            <NotificationBell linkFor={(r) => (r.type === 'UserRequest' ? `/portal/requests/${r.id}` : null)} />
            <span className="ms-2 hidden text-ink-secondary md:inline">{user?.name}</span>
            <button
              type="button"
              disabled={signOut.isPending}
              onClick={doSignOut}
              className="ms-2 hidden items-center gap-1.5 px-2 py-1.5 text-ink-secondary hover:bg-surface-hover hover:text-ink sm:inline-flex"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
            <button
              type="button"
              className="ms-1 inline-flex size-9 items-center justify-center text-ink lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="portal-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <div id="portal-menu" className="border-t border-line px-5 py-4 lg:hidden">
            <nav aria-label="Portal" className="space-y-1">
              {links('menu')}
            </nav>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-[13px] sm:hidden">
              <span className="text-ink-secondary">{user?.name}</span>
              <button
                type="button"
                disabled={signOut.isPending}
                onClick={doSignOut}
                className="inline-flex items-center gap-1.5 px-2 py-1.5 text-ink hover:bg-surface-hover"
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        ) : null}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full outline-none max-w-6xl flex-1 px-5 py-10 sm:px-8 md:py-14">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-ink-muted sm:px-8">
          <span>
            {env.appName} {env.platformName}
          </span>
          <span>Signed in as {user?.name}</span>
        </div>
      </footer>
    </PublicTheme>
  );
}
