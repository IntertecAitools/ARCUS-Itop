import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { Logo } from '@/components/layout';
import { PublicTheme, PublicThemeToggle, SkipLink } from '@/components/public';
import { cn } from '@/lib/utils';
import { useProductName } from '@/features/branding';
import { useSessionStore } from '@/stores/session.store';
import { LanguagePicker, useSignOut } from '@/features/auth';
import { NotificationBell } from '@/features/inbox';
import { usePendingApprovalCount } from '@/features/approvals';

const LINKS = [
  { to: '/portal', label: 'Home', end: true },
  { to: '/portal/requests', label: 'My requests', end: false },
  { to: '/portal/new', label: 'New request', end: false },
  { to: '/portal/help', label: 'Knowledge base', end: false },
  { to: '/portal/approvals', label: 'Approvals', end: false },
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
  const { data: pendingApprovals = 0 } = usePendingApprovalCount();

  // A link in the phone menu was followed: fold the menu away.
  useEffect(() => setMenuOpen(false), [pathname]);

  const doSignOut = () =>
    signOut.mutate(undefined, {
      onSettled: () => {
        clear();
        navigate('/login', { replace: true });
      },
    });

  // Approvals is offered to the people who have some to give, or once given.
  const links = (variant: 'bar' | 'menu') =>
    LINKS.filter((link) => link.to !== '/portal/approvals' || pendingApprovals > 0 || pathname.startsWith('/portal/approvals')).map((link) => (
      <NavLink
        key={link.to}
        to={link.to}
        end={link.end}
        className={({ isActive }) =>
          cn(
            'text-[14px] whitespace-nowrap transition-colors',
            variant === 'bar'
              ? 'flex h-16 items-center border-b-2'
              : 'block border-s-2 py-2.5 ps-4',
            isActive ? 'border-brand text-ink' : 'border-transparent text-ink-secondary hover:text-ink',
          )
        }
      >
        {link.label}
        {link.to === '/portal/approvals' && pendingApprovals > 0 ? (
          <span className="ms-1.5 rounded-pill bg-warning-soft px-1.5 py-px text-[11px] font-semibold text-warning-ink tabular-nums">
            <span className="sr-only">, waiting: </span>
            {pendingApprovals}
          </span>
        ) : null}
      </NavLink>
    ));

  const productName = useProductName().full;
  return (
    <PublicTheme className="flex flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
          <Link to="/portal" className="flex items-center gap-3" aria-label={`${productName}`}>
            <Logo collapsed />
            <span className="hidden text-[15px] font-medium tracking-tight whitespace-nowrap text-ink sm:inline">
              {productName}
            </span>
          </Link>
          <nav aria-label="Portal" className="hidden flex-1 gap-6 lg:flex">
            {links('bar')}
          </nav>
          <div className="ms-auto flex items-center gap-1 text-[13px] lg:ms-0">
            <LanguagePicker className="max-sm:hidden" />
            <PublicThemeToggle />
            {/* End users only reach their own requests here. */}
            <NotificationBell
              linkFor={(r) => (r.type === 'UserRequest' ? `/portal/requests/${r.id}` : null)}
              approvalLink={(id) => `/portal/approvals/${id}`}
            />
            <span className="ms-2 hidden whitespace-nowrap text-ink-secondary xl:inline">{user?.name}</span>
            <button
              type="button"
              disabled={signOut.isPending}
              onClick={doSignOut}
              className="ms-2 hidden items-center gap-1.5 rounded-control px-2 py-1.5 whitespace-nowrap text-ink-secondary hover:bg-surface-hover hover:text-ink sm:inline-flex"
            >
              <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
              Sign out
            </button>
            <button
              type="button"
              className="ms-1 inline-flex size-9 items-center justify-center rounded-control text-ink lg:hidden"
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
            <LanguagePicker className="mt-3 sm:hidden" />
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-[13px] sm:hidden">
              <span className="text-ink-secondary">{user?.name}</span>
              <button
                type="button"
                disabled={signOut.isPending}
                onClick={doSignOut}
                className="inline-flex items-center gap-1.5 px-2 py-1.5 text-ink hover:bg-surface-hover"
              >
                <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        ) : null}
      </header>
      <main id="main" tabIndex={-1} className="page-in mx-auto w-full outline-none max-w-6xl flex-1 px-5 py-10 sm:px-8 md:py-14">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-ink-muted sm:px-8">
          <span>
            {productName}
          </span>
          <span>Signed in as {user?.name}</span>
        </div>
      </footer>
    </PublicTheme>
  );
}
