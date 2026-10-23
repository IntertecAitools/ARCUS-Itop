import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  BellRing,
  ClipboardCheck,
  Database,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  ListFilter,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

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
  /**
   * Registered and routable, but kept out of the sidebar and the palette.
   *
   * For screens that are reached from somewhere else rather than chosen from a
   * menu. The generic record screens are the case this exists for: every one
   * of iTop's ~41 navigation entries links into `/records/<class>`, so those
   * routes must exist, while a separate "Records" nav item would only be a
   * second, developer-facing way into the same screens.
   *
   * It does NOT weaken the registry rule: a module is still listed here only
   * once it is built. This says where it is offered, not whether it exists.
   */
  hidden?: boolean;
  /**
   * Offered only to administrators. The route still exists for everyone and
   * the BFF refuses the API to anyone else; this only keeps it out of their menus.
   */
  adminOnly?: boolean;
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
    id: 'approvals',
    label: 'Approvals',
    path: 'approvals',
    icon: ClipboardCheck,
    group: 'operations',
    description: 'Requests waiting for your approval, and the ones you decided.',
    badgeKey: 'pendingApprovals',
    component: lazy(() =>
      import('@/features/approvals').then((m) => ({ default: m.ApprovalListPage })),
    ),
    children: [
      {
        path: ':id',
        label: 'Approval',
        component: lazy(() =>
          import('@/features/approvals').then((m) => ({ default: m.ApprovalDetailPage })),
        ),
      },
    ],
  },
  {
    id: 'incidents',
    label: 'Incidents',
    path: 'incidents',
    icon: LifeBuoy,
    group: 'operations',
    description: 'Unplanned interruptions to a service.',
    badgeKey: 'openIncidents',
    // Reached from iTop's own Incident Management group and from the
    // dashboard's cross-links, rather than from a nav item of its own.
    hidden: true,
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
    description: 'Every record type, browsable and editable.',
    // The target of every iTop navigation entry; not a menu item itself.
    hidden: true,
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
      // `new` and `import` before `:id`, or they are matched as a record id.
      {
        path: ':className/import',
        label: 'Import',
        component: lazy(() =>
          import('@/features/records').then((m) => ({ default: m.RecordImportPage })),
        ),
      },
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
    id: 'dashboards',
    label: 'Dashboards',
    path: 'dashboards',
    icon: LayoutGrid,
    group: 'resources',
    description: 'iTop overview dashboards.',
    // Reached from the "Overview" entries in each module group.
    hidden: true,
    component: lazy(() =>
      import('@/features/itop-dashboards').then((m) => ({ default: m.DashboardViewPage })),
    ),
    children: [
      {
        path: ':id',
        component: lazy(() =>
          import('@/features/itop-dashboards').then((m) => ({ default: m.DashboardViewPage })),
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
    description: 'All modules and what each provides.',
    // Reached from the 'All' link in the sidebar's iTop modules header.
    hidden: true,
    component: lazy(() =>
      import('@/features/navigation').then((m) => ({ default: m.ModulesIndexPage })),
    ),
  },
  {
    id: 'queries',
    label: 'Queries',
    path: 'queries',
    icon: ListFilter,
    group: 'resources',
    description: 'Saved searches over any kind of record: run, export, share.',
    component: lazy(() => import('@/features/queries').then((m) => ({ default: m.QueryListPage }))),
    children: [
      // `:id/run` before `:id`, so the results are not read as an editor.
      {
        path: ':id/run',
        label: 'Results',
        component: lazy(() => import('@/features/queries').then((m) => ({ default: m.QueryRunPage }))),
      },
      {
        path: ':id',
        label: 'Query',
        component: lazy(() => import('@/features/queries').then((m) => ({ default: m.QueryEditorPage }))),
      },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    path: 'users',
    icon: UsersRound,
    group: 'administration',
    description: 'Accounts, profiles and who may sign in.',
    adminOnly: true,
    component: lazy(() => import('@/features/users').then((m) => ({ default: m.UserListPage }))),
    children: [
      {
        path: ':id',
        label: 'User',
        component: lazy(() => import('@/features/users').then((m) => ({ default: m.UserEditorPage }))),
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: 'notifications',
    icon: BellRing,
    group: 'administration',
    description: 'Who gets an email when tickets are created, assigned or resolved.',
    adminOnly: true,
    component: lazy(() =>
      import('@/features/notifications').then((m) => ({ default: m.NotificationListPage })),
    ),
    children: [
      {
        path: ':id',
        label: 'Rule',
        component: lazy(() =>
          import('@/features/notifications').then((m) => ({ default: m.NotificationEditorPage })),
        ),
      },
    ],
  },
  {
    id: 'audit',
    label: 'Audit',
    path: 'audit',
    icon: ShieldCheck,
    group: 'administration',
    description: 'Data-quality checks on the CMDB: the records that fail them, and the checks themselves.',
    adminOnly: true,
    component: lazy(() => import('@/features/audit').then((m) => ({ default: m.AuditPage }))),
    children: [
      {
        path: 'categories/:id',
        label: 'Category',
        component: lazy(() => import('@/features/audit').then((m) => ({ default: m.CategoryEditorPage }))),
      },
      {
        path: 'rules/:id',
        label: 'Rule',
        component: lazy(() => import('@/features/audit').then((m) => ({ default: m.RuleEditorPage }))),
      },
    ],
  },
];

export const navGroups: NavGroup[] = ['operations', 'resources', 'administration'];

/**
 * Modules offered in the chrome: the sidebar and the Ctrl-K palette.
 *
 * Routing uses `modules` instead, because a hidden module still routes. Keep
 * these two separate — conflating them is how a reachable screen becomes
 * unreachable, or a hidden one reappears in a menu.
 */
export function navigableModules(isAdmin = false) {
  return modules.filter((m) => !m.hidden && (!m.adminOnly || isAdmin));
}

export function modulesInGroup(group: NavGroup, isAdmin = false) {
  return navigableModules(isAdmin).filter((m) => m.group === group);
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
