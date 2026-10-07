import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, Topbar } from '@/components/layout';
import { CommandPalette } from '@/components/overlays';
import { ErrorBoundary, RouteFallback } from '@/components/feedback';
import { useUiStore } from '@/stores/ui.store';
import { useNavCounts } from '@/app/hooks/useNavCounts';
import { cn } from '@/lib/utils';

/**
 * The agent-facing shell: fixed sidebar + fixed topbar, scrolling content well.
 *
 * Modules render into the <Outlet/>. They never render chrome of their own —
 * a module is a page body plus a <PageHeader/>, nothing more.
 */
export function AgentLayout() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const { data: counts } = useNavCounts();

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-overlay"
      >
        Skip to content
      </a>

      <Sidebar counts={counts} />
      <Topbar />

      <main
        id="main"
        className={cn(
          'pt-topbar transition-[padding] duration-200 ease-out',
          collapsed ? 'pl-sidebar-collapsed' : 'pl-sidebar',
        )}
      >
        <div className="mx-auto max-w-[1600px] px-6 py-6">
          {/* A module crash stays inside the content well — the shell survives. */}
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <CommandPalette />
    </div>
  );
}
