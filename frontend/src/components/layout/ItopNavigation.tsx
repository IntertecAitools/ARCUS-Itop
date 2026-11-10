import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { modulesAtHome, moduleHomes, navigableModules, type ModuleDefinition } from '@/config/modules';
import { activeEntryId, activeGroupId, entryPath, useNavigation, type NavEntry, type NavGroup } from '@/features/navigation';
import { useSessionStore } from '@/stores/session.store';
import { useUiStore } from '@/stores/ui.store';

/**
 * The sidebar's modules: iTop's own menu groups, rendered from what the BFF
 * publishes, each with the pages we built for it listed after iTop's entries
 * (`ModuleDefinition.home`). Change management holds the CAB queue and the
 * calendar, Service management the SLA screens, and so on.
 *
 * Nothing about iTop's groups is hardcoded except the icons and the merging
 * rules below: install a module in iTop, re-extract, restart the BFF, and its
 * group appears.
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

/** iTop's "Configuration" group (mail access) is one entry: it joins Administration. */
const MERGED_INTO: Record<string, string> = { ConfigurationTools: 'AdminTools' };

/**
 * iTop entries that one of our pages replaces. Each is dropped only when the
 * replacing page is offered to this user, so nobody loses a way in.
 */
const REPLACED_BY: Record<string, string> = {
  UserAccountsMenu: 'users',
  AuditCategories: 'audit',
  CustomerContract: 'service-levels',
  SLA: 'service-levels',
  SLT: 'service-levels',
};

const KIND_HINT: Record<string, string> = {
  create: 'New',
  search: 'Search',
};

const ENTRY_CLASSES = 'flex items-center gap-2 rounded-control py-1.5 pe-2 ps-3 text-[13px] transition-colors duration-150';
const entryState = (active: boolean) =>
  active ? 'bg-brand-soft text-brand-ink' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink';

/** One sidebar module: iTop's entries for it, then our pages. */
export interface SidebarGroup {
  id: string;
  label: string;
  isAdmin?: boolean;
  entries: NavEntry[];
  pages: ModuleDefinition[];
}

/**
 * iTop's groups with our pages merged in. Pure, so the merging rules are
 * tested without rendering.
 */
export function sidebarGroups(groups: NavGroup[], isAdmin: boolean): SidebarGroup[] {
  const offered = new Set(navigableModules(isAdmin).map((m) => m.id));
  const keep = (e: NavEntry) => !(REPLACED_BY[e.id] && offered.has(REPLACED_BY[e.id]!));

  const merged: SidebarGroup[] = [];
  for (const group of groups) {
    const into = MERGED_INTO[group.id];
    const target = into ? merged.find((g) => g.id === into) : undefined;
    if (target) {
      target.entries.push(...group.entries.filter(keep));
      continue;
    }
    merged.push({ id: group.id, label: group.label, isAdmin: group.isAdmin, entries: group.entries.filter(keep), pages: [] });
  }

  // A home iTop did not publish (a module not installed, the mock API) still
  // gets its group, so a built page never drops out of the sidebar.
  for (const home of moduleHomes) {
    const pages = modulesAtHome(home.id, isAdmin);
    if (pages.length === 0) continue;
    const group = merged.find((g) => g.id === home.id);
    if (group) group.pages = pages;
    else merged.push({ id: home.id, label: home.label, entries: [], pages });
  }

  return merged.filter((g) => g.entries.length + g.pages.length > 0);
}

/** Does the current address belong to this page (its list or any screen under it)? */
const onPage = (pathname: string, page: ModuleDefinition) =>
  pathname === `/${page.path}` || pathname.startsWith(`/${page.path}/`);

function PageLink({ page, count }: { page: ModuleDefinition; count?: number }) {
  const { t } = useTranslation();
  const Icon = page.icon;
  return (
    <NavLink to={`/${page.path}`} className={({ isActive }) => cn(ENTRY_CLASSES, entryState(isActive))}>
      <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="flex-1 truncate">{t(`nav.${page.id}`, { defaultValue: page.label })}</span>
      {count ? (
        <span className="shrink-0 rounded-pill bg-critical-soft px-1.5 py-0.5 text-[11px] font-semibold text-critical-ink tabular-nums">
          {count}
        </span>
      ) : null}
    </NavLink>
  );
}

function GroupSection({
  group,
  open,
  onToggle,
  activeId,
  counts,
}: {
  group: SidebarGroup;
  open: boolean;
  onToggle: () => void;
  activeId: string | null;
  counts: Record<string, number | undefined>;
}) {
  const Icon = GROUP_ICONS[group.id] ?? LayoutGrid;

  // A group with one entry is not a menu: it is that entry, linked directly.
  if (group.entries.length === 1 && group.pages.length === 0) {
    const only = group.entries[0]!;
    const active = only.id === activeId;
    return (
      <Link
        to={entryPath(only)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-control px-3 py-1.5 text-[12px] font-semibold tracking-wide',
          'transition-colors duration-150',
          active ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink-secondary',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{group.label}</span>
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-control px-3 py-1.5 text-start',
          'text-[12px] font-semibold tracking-wide text-ink-muted uppercase',
          'transition-colors duration-150 hover:bg-surface-hover hover:text-ink-secondary',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate normal-case">{group.label}</span>
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform duration-150 rtl:-scale-x-100', open && 'rotate-90 rtl:-rotate-90')}
          aria-hidden
        />
      </button>

      {open ? (
        <ul className="mt-0.5 space-y-0.5 ps-3" aria-label={group.label}>
          {group.entries.map((entry) => {
            // One item lights at a time: path AND view must match (see activeEntryId).
            const active = entry.id === activeId;
            return (
              <li key={entry.id}>
                <Link
                  to={entryPath(entry)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(ENTRY_CLASSES, entryState(active))}
                >
                  <span className="flex-1 truncate">{entry.label}</span>
                  {KIND_HINT[entry.kind] ? (
                    <span className="shrink-0 text-[10.5px] font-medium tracking-wide text-ink-muted uppercase">
                      {KIND_HINT[entry.kind]}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          {group.pages.map((page, index) => (
            <li
              key={page.id}
              // A hairline between iTop's entries and our pages, once.
              className={cn(index === 0 && group.entries.length > 0 && 'mt-1 border-t border-line pt-1')}
            >
              <PageLink page={page} count={page.badgeKey ? counts[page.badgeKey] : undefined} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ItopNavigation({
  collapsed,
  counts = {},
}: {
  collapsed: boolean;
  counts?: Record<string, number | undefined>;
}) {
  const { data, isLoading, isError } = useNavigation();
  const { pathname, search } = useLocation();
  const userId = useSessionStore((s) => s.user?.id);
  const isAdmin = useSessionStore((s) => s.user?.isAdmin ?? false);
  const opened = useUiStore((s) => s.navGroupsOpen);
  const setNavGroupOpen = useUiStore((s) => s.setNavGroupOpen);
  const resetNavGroups = useUiStore((s) => s.resetNavGroups);

  // A new sign-in starts from the default: only the current page's group open.
  useEffect(() => resetNavGroups(), [userId, resetNavGroups]);

  // Collapsed to icons there is no room for a tree: the sidebar shows every
  // page as an icon, and the groups fold into one link to the modules index.
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

  // Without iTop's tree, our pages still render in their groups: a failure
  // there must not hide the screens we built.
  const itopGroups = isError || !data ? [] : data.groups;
  const groups = sidebarGroups(itopGroups, isAdmin);
  if (groups.length === 0) return null;

  const activeId = activeEntryId(itopGroups, pathname, search);
  const activeGroup =
    activeGroupId(itopGroups, activeId) ??
    groups.find((g) => g.pages.some((p) => onPage(pathname, p)))?.id ??
    null;
  // Merged groups (Configuration into Administration) open with their host.
  const activeHost = activeGroup ? (MERGED_INTO[activeGroup] ?? activeGroup) : null;

  return (
    <div role="group" aria-label="Modules" className="mt-3 space-y-1.5 border-t border-line pt-3">
      <div className="flex items-baseline justify-between px-3 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">Modules</span>
        <Link to="/modules" className="text-[11px] text-brand-ink hover:underline">
          All
        </Link>
      </div>

      {groups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          activeId={activeId}
          counts={counts}
          // What the user clicked wins; otherwise only the group holding the
          // current page is open, so the page you are on is never folded away.
          open={opened[group.id] ?? group.id === activeHost}
          onToggle={() => setNavGroupOpen(group.id, !(opened[group.id] ?? group.id === activeHost))}
        />
      ))}
    </div>
  );
}
