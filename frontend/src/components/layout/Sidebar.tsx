import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session.store';
import { modulesInGroup, navGroups, type ModuleDefinition } from '@/config/modules';
import { useUiStore } from '@/stores/ui.store';
import { ItopNavigation } from './ItopNavigation';
import { Logo } from './Logo';

/** Counts that feed the sidebar badges, keyed by `ModuleDefinition.badgeKey`. */
export type NavCounts = Record<string, number | undefined>;

interface SidebarProps {
  counts?: NavCounts;
}

function NavItem({
  module,
  collapsed,
  count,
}: {
  module: ModuleDefinition;
  collapsed: boolean;
  count?: number;
}) {
  const Icon = module.icon;

  return (
    <NavLink
      to={`/${module.path}`}
      title={collapsed ? module.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-control py-2 text-[13.5px] font-medium',
          'transition-colors duration-150',
          collapsed ? 'justify-center px-2' : 'px-3',
          isActive
            ? 'bg-brand-soft text-brand-ink'
            : 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Active marker: a shape, so "which page am I on" is not colour-only. */}
          <span
            aria-hidden
            className={cn(
              'absolute top-1/2 start-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand shadow-[0_0_12px_var(--arcus-brand)] transition-opacity duration-150',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <Icon className="size-[18px] shrink-0" aria-hidden />
          {!collapsed ? <span className="flex-1 truncate">{module.label}</span> : null}
          {count ? (
            <span
              className={cn(
                'shrink-0 rounded-pill text-[11px] font-semibold tabular-nums',
                collapsed
                  ? 'absolute top-0.5 end-3 flex min-w-4 items-center justify-center px-1 leading-4 ring-2 ring-[color:var(--arcus-surface)] bg-critical text-on-critical'
                  : 'bg-critical-soft px-1.5 py-0.5 text-critical-ink',
              )}
            >
              {collapsed && count > 9 ? '9+' : count}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/** The rail only collapses on wide screens; below `lg` it is a full-width drawer. */
const WIDE = '(min-width: 1024px)';

function useIsWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}

export function Sidebar({ counts = {} }: SidebarProps) {
  const isAdmin = useSessionStore((s) => s.user?.isAdmin ?? false);
  const wide = useIsWide();
  const collapsed = useUiStore((s) => s.sidebarCollapsed) && wide;
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

  return (
    <aside
      id="app-sidebar"
      className={cn(
        'fixed inset-y-0 start-0 z-30 flex w-sidebar flex-col border-e border-line bg-surface',
        'transition-[width,translate,visibility] duration-200 ease-out',
        collapsed ? 'lg:w-sidebar-collapsed' : 'lg:w-sidebar',
        // Phones and tablets: off-canvas until the topbar's menu button opens it.
        !wide && !mobileNavOpen && 'invisible -translate-x-full rtl:translate-x-full',
      )}
    >
      <div
        className={cn(
          'flex h-topbar shrink-0 items-center justify-between border-b border-line',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <Logo collapsed={collapsed} />
        {!wide ? (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="inline-flex size-9 items-center justify-center rounded-control text-ink-secondary hover:bg-surface-hover hover:text-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* The label belongs on the <nav> landmark, not the <aside> — on the
          <aside> it names a `complementary` region and leaves the navigation
          landmark itself unnamed. */}
      <nav
        aria-label="Main navigation"
        className="flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-3"
      >
        {/* Only groups that actually contain a built module are rendered —
            otherwise an empty group still draws its separator rule. */}
        {/* Scoped so "which modules have we built" stays answerable now that
            iTop's whole tree is rendered below it. */}
        <div aria-label="Built modules" role="group">
          {navGroups
            .map((group) => ({ group, items: modulesInGroup(group, isAdmin) }))
            .filter(({ items }) => items.length > 0)
            .map(({ group, items }, groupIndex) => (
              <div
                key={group}
                className={cn(groupIndex > 0 && 'mt-3 border-t border-line pt-3', 'space-y-0.5')}
              >
                {items.map((module) => (
                  <NavItem
                    key={module.id}
                    module={module}
                    collapsed={collapsed}
                    count={module.badgeKey ? counts[module.badgeKey] : undefined}
                  />
                ))}
              </div>
            ))}
        </div>

        {/* Above: modules we have built. Below: everything else iTop has,
            rendered from the tree the BFF publishes. */}
        <ItopNavigation collapsed={collapsed} />
      </nav>

      <div className="hidden shrink-0 border-t border-line p-2.5 lg:block">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          className={cn(
            'flex w-full items-center gap-3 rounded-control py-2 text-[13.5px] font-medium',
            'text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink-secondary',
            collapsed ? 'justify-center px-2' : 'px-3',
          )}
        >
          <ChevronLeft
            className={cn('size-[18px] shrink-0 transition-transform duration-200 rtl:-scale-x-100', collapsed && 'rotate-180')}
            aria-hidden
          />
          {!collapsed ? <span>Collapse</span> : null}
          <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
        </button>
      </div>
    </aside>
  );
}
