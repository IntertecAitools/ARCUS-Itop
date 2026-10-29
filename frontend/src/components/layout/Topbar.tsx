import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, KeyRound, LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Avatar, IconButton } from '@/components/ui';
import { useUiStore } from '@/stores/ui.store';
import { useSessionStore } from '@/stores/session.store';
import { ChangePasswordDialog, useSignOut } from '@/features/auth';
import { NotificationBell } from '@/features/inbox';
import { isModuleRegistered } from '@/config/modules';

function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const isDark = theme === 'dark';

  return (
    <IconButton
      label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      icon={isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    />
  );
}

function UserMenu() {
  const user = useSessionStore((s) => s.user);
  const clearSession = useSessionStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const signOut = useSignOut();
  const navigate = useNavigate();

  const onSignOut = () => {
    setOpen(false);
    signOut.mutate(undefined, {
      onSettled: () => {
        clearSession();
        navigate('/login', { replace: true });
      },
    });
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-control py-1 pe-2 ps-1 transition-colors hover:bg-surface-hover"
      >
        <Avatar name={user.name} src={user.avatarUrl} size="md" />
        {/* Visually hidden on phones, but always the button's accessible name. */}
        <span className="sr-only min-w-0 text-start sm:not-sr-only sm:block">
          <span className="block truncate text-[13px] leading-4 font-semibold text-ink">
            {user.name}
          </span>
          <span className="block truncate text-[11px] leading-4 text-ink-muted">{user.role}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute end-0 z-50 mt-2 w-56 overflow-hidden rounded-card border border-line bg-surface-raised py-1 shadow-overlay"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-[13px] font-semibold text-ink">{user.name}</p>
            <p className="truncate text-[11px] text-ink-muted">{user.email}</p>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChangingPassword(true);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-ink-secondary transition-colors hover:bg-surface-hover"
          >
            <KeyRound className="size-4" aria-hidden />
            Change password
          </button>
          <button
            role="menuitem"
            onClick={onSignOut}
            disabled={signOut.isPending}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-critical-ink transition-colors hover:bg-surface-hover"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
      {changingPassword ? <ChangePasswordDialog onClose={() => setChangingPassword(false)} /> : null}
    </div>
  );
}

export function Topbar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

  // Ctrl/⌘-K opens search from anywhere — the hint chip in the field is the
  // discoverability half of this; the handler is the other half.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setCommandPaletteOpen]);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-20 flex h-topbar items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur-xl',
        'transition-[padding] duration-200 ease-out',
        collapsed ? 'lg:ps-[calc(var(--spacing-sidebar-collapsed)+1.5rem)]' : 'lg:ps-[calc(var(--spacing-sidebar)+1.5rem)]',
      )}
    >
      {/* Phones and tablets: the sidebar is a drawer behind this button. */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        aria-expanded={mobileNavOpen}
        aria-controls="app-sidebar"
        aria-label="Open menu"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-ink hover:bg-surface-hover lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className={cn(
          'flex h-9 w-full min-w-0 max-w-3xl items-center gap-2.5 rounded-control border border-line bg-surface-sunken px-3',
          'text-start transition-colors duration-150 hover:border-line-strong hover:bg-surface-hover',
          'focus-visible:border-brand',
        )}
      >
        <Search className="size-4 shrink-0 text-ink-muted" aria-hidden />
        <span className="flex-1 truncate text-sm text-ink-muted">
          Search incidents, requests, assets, knowledge articles…
        </span>
        <kbd className="hidden shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-muted sm:block">
          Ctrl K
        </kbd>
      </button>

      <div className="ms-auto flex items-center gap-1">
        <ThemeToggle />
        {/* Incidents have their own screens; everything else opens as a record. */}
        <NotificationBell
          linkFor={(r) =>
            r.type === 'Incident' && isModuleRegistered('/incidents') ? `/incidents/${r.id}` : `/records/${r.type}/${r.id}`
          }
        />
        <IconButton label="Help and documentation" icon={<CircleHelp className="size-[18px]" />} className="max-sm:hidden" />
        <div className="mx-1 h-6 w-px bg-line max-sm:hidden" aria-hidden />
        <UserMenu />
      </div>
    </header>
  );
}
