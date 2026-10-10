import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  ChevronRight,
  Boxes,
  Database,
  FileWarning,
  Headphones,
  LayoutGrid,
  RefreshCw,
  Settings,
  ShieldCheck,
  Siren,
  Layers,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { entryPath, useNavigation, type NavGroup } from '@/features/navigation';

/**
 * iTop's own menu groups, rendered from what the BFF publishes.
 *
 * Nothing here is hardcoded except the icons: install a module in iTop,
 * re-extract, restart the BFF, and its group appears. That is the point —
 * a hand-written list would have to be edited in a second place every time.
 */

/** Icons for iTop's group ids. A group we have no icon for still renders. */
const GROUP_ICONS: Record<string, LucideIcon> = {
  ConfigManagement: Boxes,
  RequestManagement: Headphones,
  IncidentManagement: Siren,
  ProblemManagement: FileWarning,
  ChangeManagement: RefreshCw,
  ServiceManagement: Layers,
  DataAdministration: Database,
  AdminTools: ShieldCheck,
  ConfigurationTools: Settings,
};

const KIND_HINT: Record<string, string> = {
  create: 'New',
  search: 'Search',
};

function GroupSection({
  group,
  defaultOpen,
}: {
  group: NavGroup;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = GROUP_ICONS[group.id] ?? LayoutGrid;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-control px-3 py-1.5 text-left',
          'text-[12px] font-semibold tracking-wide text-ink-muted uppercase',
          'transition-colors duration-150 hover:bg-surface-hover hover:text-ink-secondary',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate normal-case">{group.label}</span>
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90')}
          aria-hidden
        />
      </button>

      {open ? (
        <ul className="mt-0.5 space-y-0.5 pl-3">
          {group.entries.map((entry) => (
            <li key={entry.id}>
              <NavLink
                to={entryPath(entry)}
                // `end` is wrong here: a filtered view and a plain list share a
                // path and differ only by query string, so matching on the path
                // alone would light up both.
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-control py-1.5 pr-2 pl-3 text-[13px]',
                    'transition-colors duration-150',
                    isActive
                      ? 'bg-brand-soft text-brand-ink'
                      : 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
                  )
                }
              >
                <span className="flex-1 truncate">{entry.label}</span>
                {KIND_HINT[entry.kind] ? (
                  <span className="shrink-0 text-[10.5px] font-medium tracking-wide text-ink-muted uppercase">
                    {KIND_HINT[entry.kind]}
                  </span>
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ItopNavigation({ collapsed }: { collapsed: boolean }) {
  const { data, isLoading, isError } = useNavigation();
  const { pathname, search } = useLocation();

  // Collapsed to icons there is no room for a tree, so the groups fold into a
  // single link to the index that lists all of them. Everything stays
  // reachable, which matters more than showing the shape.
  if (collapsed) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <Link
          to="/modules"
          title="All modules"
          className={cn(
            'flex items-center justify-center rounded-control px-2 py-2',
            'text-ink-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-ink',
          )}
        >
          <LayoutGrid className="size-[18px]" aria-hidden />
          <span className="sr-only">All modules</span>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-3 space-y-2 border-t border-line pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mx-3 h-4 animate-pulse rounded bg-surface-hover" />
        ))}
      </div>
    );
  }

  // A failure here must not take the built modules down with it: those work
  // without the navigation, and a dead sidebar would hide the whole app.
  if (isError || !data || data.groups.length === 0) return null;

  const current = pathname + search;

  return (
    <div
      role="group"
      aria-label="iTop modules"
      className="mt-3 space-y-1.5 border-t border-line pt-3"
    >
      <div className="flex items-baseline justify-between px-3 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
          iTop modules
        </span>
        <Link to="/modules" className="text-[11px] text-brand-ink hover:underline">
          All
        </Link>
      </div>

      {data.groups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          // Open the group you are already inside, so a reload does not fold
          // the page you are looking at out of sight.
          defaultOpen={group.entries.some((entry) => current.startsWith(entryPath(entry)))}
        />
      ))}
    </div>
  );
}
