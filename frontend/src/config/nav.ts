import {
  BookOpen,
  Building2,
  Bug,
  ChartColumn,
  ClipboardList,
  GitPullRequestArrow,
  LayoutDashboard,
  LibraryBig,
  Network,
  Package,
  Rocket,
  Settings,
  Timer,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { routes } from './routes';

export interface NavItem {
  /** i18n key in the `nav` namespace */
  key: string;
  href: string;
  icon: LucideIcon;
  /** false → rendered by the shared placeholder page */
  implemented: boolean;
}

export const mainNav: NavItem[] = [
  { key: 'dashboard', href: routes.dashboard, icon: LayoutDashboard, implemented: true },
  { key: 'serviceMap', href: '/service-map', icon: Network, implemented: false },
  { key: 'incidents', href: '/incidents', icon: TriangleAlert, implemented: false },
  { key: 'serviceRequests', href: '/service-requests', icon: ClipboardList, implemented: false },
  { key: 'problems', href: routes.problems.dashboard, icon: Bug, implemented: true },
  { key: 'changes', href: '/changes', icon: GitPullRequestArrow, implemented: false },
  { key: 'releases', href: '/releases', icon: Rocket, implemented: false },
  { key: 'assets', href: '/assets', icon: Package, implemented: false },
  { key: 'knowledgeBase', href: routes.knownErrors.list(), icon: BookOpen, implemented: true },
  { key: 'reports', href: '/reports', icon: ChartColumn, implemented: false },
];

export const adminNav: NavItem[] = [
  { key: 'usersAccess', href: '/admin/users', icon: Users, implemented: false },
  { key: 'departments', href: '/admin/departments', icon: Building2, implemented: false },
  { key: 'serviceCatalogue', href: '/admin/service-catalogue', icon: LibraryBig, implemented: false },
  { key: 'slas', href: '/admin/slas', icon: Timer, implemented: false },
  { key: 'settings', href: '/settings', icon: Settings, implemented: false },
];

export const allNav: NavItem[] = [...mainNav, ...adminNav];

/** Nav item whose section contains the pathname (/problems/12 → Problems). */
export function findActiveNav(pathname: string): NavItem | undefined {
  const firstSegment = (path: string) => `/${path.split('?')[0]!.split('/')[1] ?? ''}`;
  const section = firstSegment(pathname);
  return (
    allNav.find((item) => item.href === pathname) ??
    allNav.find((item) => {
      if (section === '/admin') return pathname.startsWith(item.href);
      return firstSegment(item.href) === section;
    })
  );
}

/** Placeholder routes: any nav item that is not implemented yet. */
export function findPlaceholderNav(pathname: string): NavItem | undefined {
  return allNav.find((item) => !item.implemented && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
}
