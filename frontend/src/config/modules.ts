import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Database, LayoutDashboard, LayoutGrid, LifeBuoy, type LucideIcon } from 'lucide-react';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE MODULE REGISTRY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This file is the single source of truth for what the app contains. The
 * sidebar, the route table and the Ctrl-K palette are all generated from it —
 * none of them has its own hardcoded list.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * A module appears here ONLY once it is actually built. Nothing is listed
 * ahead of time: no dead nav items, no routes that lead to an apology, no
 * search results for screens that don't exist. If you can see it, it works.
 *
 * ── Adding a module ────────────────────────────────────────────────────────
 *   1. Build the feature under `src/features/<feature>/` (pages/, api/, …)
 *      and export its route-level screens from `src/features/<feature>/index.ts`.
 *   2. Add one entry to `modules` below:
 *
 *        {
 *          id: 'incidents',
 *          label: 'Incidents',
 *          path: 'incidents',
 *          icon: LifeBuoy,                    // from lucide-react
 *          group: 'operations',
 *          description: 'Unplanned interruptions to a service.',
 *          badgeKey: 'openIncidents',         // optional sidebar count
 *          component: lazy(() =>
 *            import('@/features/incidents').then((m) => ({ default: m.IncidentListPage })),
 *          ),
 *          children: [
 *            {
 *              path: ':id',
 *              component: lazy(() =>
 *                import('@/features/incidents').then((m) => ({ default: m.IncidentDetailPage })),
 *              ),
 *            },
 *          ],
 *        }
 *
 * Nav item, route, breadcrumb and palette entry all light up from that one
 * edit. Keep `component` lazy so the shell never pulls a module's code until
 * someone visits it.
 */

/** Visual grouping in the sidebar — each group is separated by a hairline. */
export type NavGroup = 'operations' | 'resources' | 'administration';

export interface ModuleDefinition {
  /** Stable id. Also the i18n key and the query-key namespace. */
  id: string;
  /** Sidebar label. */
  label: string;
  /** Route path under the agent layout, without a leading slash. */
  path: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Short line shown in the command palette. */
  description: string;
  /**
   * Which counter (if any) feeds this item's sidebar badge. The shell reads the
   * value from the nav-counts query — the module itself owns the number.
   */
  badgeKey?: string;
  /** Route element. Required: a registered module is a built module. */
  component: LazyExoticComponent<ComponentType>;
  /** Nested routes (detail screens, tabs) owned by the module. */
  children?: ModuleRoute[];
}

export interface ModuleRoute {
  /** Path relative to the module, e.g. `:id` or `new`. */
  path: string;
  component: LazyExoticComponent<ComponentType>;
  /** Breadcrumb label; falls back to the module label. */
  label?: string;
}

export const modules: ModuleDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: 'dashboard',
    icon: LayoutDashboard,
    group: 'operations',
    description: 'KPIs, trends and your queue at a glance.',
    component: lazy(() =>
      import('@/features/dashboard').then((m) => ({ default: m.DashboardPage })),
    ),
  },
  {
    id: 'incidents',
    label: 'Incidents',
    path: 'incidents',
    icon: LifeBuoy,
    group: 'operations',
    description: 'Unplanned interruptions to a service.',
    badgeKey: 'openIncidents',
    component: lazy(() =>
      import('@/features/incidents').then((m) => ({ default: m.IncidentListPage })),
    ),
    children: [
      // `new` is declared before `:id` so it is matched as a literal rather
      // than parsed as an incident id.
      {
        path: 'new',
        label: 'New incident',
        component: lazy(() =>
          import('@/features/incidents').then((m) => ({ default: m.NewIncidentPage })),
        ),
      },
      {
        path: ':id',
        component: lazy(() =>
          import('@/features/incidents').then((m) => ({ default: m.IncidentDetailPage })),
        ),
      },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    path: 'records',
    icon: Database,
    group: 'resources',
    description: 'Every class in the iTop datamodel, browsable and editable.',
    component: lazy(() =>
      import('@/features/records').then((m) => ({ default: m.RecordsIndexPage })),
    ),
    children: [
      {
        path: ':className',
        component: lazy(() =>
          import('@/features/records').then((m) => ({ default: m.RecordListPage })),
        ),
      },
      // `new` before `:id`, or it is matched as a record id.
      {
        path: ':className/new',
        label: 'New record',
        component: lazy(() =>
          import('@/features/records').then((m) => ({ default: m.RecordNewPage })),
        ),
      },
      {
        path: ':className/:id',
        component: lazy(() =>
          import('@/features/records').then((m) => ({ default: m.RecordDetailPage })),
        ),
      },
    ],
  },
  {
    id: 'modules',
    label: 'Modules',
    path: 'modules',
    icon: LayoutGrid,
    group: 'resources',
    description: 'Every module iTop has, and what we render of it.',
    component: lazy(() =>
      import('@/features/navigation').then((m) => ({ default: m.ModulesIndexPage })),
    ),
  },
];

export const navGroups: NavGroup[] = ['operations', 'resources', 'administration'];

export function modulesInGroup(group: NavGroup) {
  return modules.filter((m) => m.group === group);
}

export function findModuleByPath(path: string) {
  return modules.find((m) => m.path === path);
}

/**
 * Is this in-app path backed by a registered module?
 *
 * Used by cross-links (a dashboard card's "View all →") so the UI never offers
 * a route to a module that hasn't been built. Links appear as modules land.
 */
export function isModuleRegistered(path: string) {
  const [, first] = path.split('?')[0].split('/');
  return modules.some((m) => m.path === first);
}

/** Where `/` lands. */
export const HOME_PATH = '/dashboard';
