import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar, Topbar } from '@/components/layout';
import { CommandPalette } from '@/components/overlays';
import { ErrorBoundary, RouteFallback } from '@/components/feedback';
import { PublicTheme, SkipLink } from '@/components/public';
import { useUiStore } from '@/stores/ui.store';
import { useNavCounts } from '@/app/hooks/useNavCounts';
import { cn } from '@/lib/utils';

/**
 * The agent-facing shell: fixed sidebar + fixed topbar, scrolling content well.
 *
 * Modules render into the <Outlet/>. They never render chrome of their own —
 * a module is a page body plus a <PageHeader/>, nothing more.
 *
 * It wears the same look as the landing page and portal (components/public),
 * dark or light from the staff theme preference. Below `lg` the sidebar is a
 * drawer opened from the topbar's menu button.
 */
export function AgentLayout() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const { data: counts } = useNavCounts();
  const { pathname, search } = useLocation();

  // A link was followed from the drawer: fold it away.
  useEffect(() => setMobileNavOpen(false), [pathname, search, setMobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setMobileNavOpen(false);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen, setMobileNavOpen]);

  return (
    <PublicTheme follow>
      <SkipLink />

      <Sidebar counts={counts} />
      {mobileNavOpen ? (
        <div
          aria-hidden
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-20 bg-[var(--arcus-scrim)] lg:hidden"
        />
      ) : null}
      <Topbar />

      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'pt-topbar outline-none transition-[padding] duration-200 ease-out',
          collapsed ? 'lg:ps-sidebar-collapsed' : 'lg:ps-sidebar',
        )}
      >
        <div className="page-in mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {/* A module crash stays inside the content well — the shell survives. */}
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <CommandPalette />
    </PublicTheme>
  );
}
