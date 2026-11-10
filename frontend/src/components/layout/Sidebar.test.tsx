import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { useSessionStore } from '@/stores/session.store';
import { useUiStore } from '@/stores/ui.store';
import type { NavEntry, NavGroup } from '@/features/navigation';
import { Sidebar } from './Sidebar';
import { sidebarGroups } from './ItopNavigation';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

const entry = (id: string, label = id): NavEntry => ({ id, kind: 'list', class: id, label, filtered: false, creatable: true });
const group = (id: string, label: string, entries: NavEntry[], isAdmin = false): NavGroup => ({ id, label, isAdmin, entries });

const ITOP: NavGroup[] = [
  group('ChangeManagement', 'Change management', [entry('Changes', 'Open changes')]),
  group('ServiceManagement', 'Service management', [entry('Service', 'Services'), entry('SLA', 'SLAs'), entry('SLT', 'SLTs'), entry('CustomerContract', 'Customer contracts')]),
  group('AdminTools', 'Administration', [entry('UserAccountsMenu', 'User accounts'), entry('ProfilesMenu', 'Profiles'), entry('AuditCategories', 'Audit configuration')], true),
  group('ConfigurationTools', 'Configuration', [entry('OAuthClient', 'OAuth Mail Access')], true),
];

describe('sidebarGroups', () => {
  it('puts each built page inside its module, after iTop’s entries', () => {
    const groups = sidebarGroups(ITOP, true);
    const change = groups.find((g) => g.id === 'ChangeManagement')!;
    expect(change.entries.map((e) => e.id)).toEqual(['Changes']);
    expect(change.pages.map((p) => p.id)).toEqual([
      'cab',
      'change-calendar',
      'pir-due',
      'change-rules',
      'change-risk',
      'change-blackouts',
    ]);
    expect(groups.find((g) => g.id === 'ServiceManagement')!.pages.map((p) => p.id)).toEqual([
      'sla',
      'service-levels',
      'business-hours',
    ]);
  });

  it('drops iTop entries our pages replace, and folds Configuration into Administration', () => {
    const groups = sidebarGroups(ITOP, true);
    expect(groups.find((g) => g.id === 'ServiceManagement')!.entries.map((e) => e.id)).toEqual(['Service']);
    const admin = groups.find((g) => g.id === 'AdminTools')!;
    expect(admin.entries.map((e) => e.id)).toEqual(['ProfilesMenu', 'OAuthClient']);
    expect(admin.pages.map((p) => p.id)).toEqual(['users', 'tenant-admin', 'notifications', 'audit']);
    expect(groups.some((g) => g.id === 'ConfigurationTools')).toBe(false);
  });

  it('keeps an iTop entry when its replacement is admin-only and the user is not an admin', () => {
    const groups = sidebarGroups(ITOP, false);
    const service = groups.find((g) => g.id === 'ServiceManagement')!;
    expect(service.entries.map((e) => e.id)).toEqual(['Service', 'SLA', 'SLT', 'CustomerContract']);
    expect(service.pages.map((p) => p.id)).toEqual(['sla']);
  });

  it('gives a page a group even when iTop does not publish its module', () => {
    const groups = sidebarGroups([], true);
    const problem = groups.find((g) => g.id === 'ProblemManagement')!;
    expect(problem.label).toBe('Problem management');
    expect(problem.pages.map((p) => p.id)).toEqual(['problem-trends', 'knowledge', 'knowledge-settings']);
  });
});

/** jsdom has no matchMedia; `wide` answers the rail's "(min-width: 1024px)". */
const screenIs = (wide: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

describe('Sidebar', () => {
  beforeEach(() => {
    screenIs(true);
    useSessionStore.getState().setUser({ id: '1', login: 'admin', name: 'Admin', email: '', role: 'Administrator', isAdmin: true });
    useUiStore.setState({ sidebarCollapsed: false, navGroupsOpen: {} });
  });
  afterEach(() => useSessionStore.getState().clear());

  it('lists only Dashboard and the day-to-day pages on top, the rest inside modules', async () => {
    renderWithProviders(<Sidebar />, { route: '/dashboard' });
    const top = screen.getByRole('group', { name: 'Built modules' });
    expect(within(top).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Dashboard',
      'Approvals',
      'My team’s queue',
      'My drafts',
      'Time logged',
      'Queries',
    ]);
    const modules = await screen.findByRole('group', { name: 'Modules' });
    expect(within(modules).getByRole('button', { name: 'Change management' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the module holding the current page, and folds on a click', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<Sidebar />, { route: '/change-calendar' });
    const change = await screen.findByRole('button', { name: 'Change management' });
    expect(change).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Change management' });
    expect(within(list).getByRole('link', { name: 'Change calendar' })).toHaveAttribute('aria-current', 'page');
    await user.click(change);
    expect(screen.queryByRole('list', { name: 'Change management' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Service management' }));
    expect(within(screen.getByRole('list', { name: 'Service management' })).getByRole('link', { name: 'Service levels' })).toBeInTheDocument();
  });

  it('shows every page as an icon when folded to the rail', () => {
    useUiStore.setState({ sidebarCollapsed: true });
    renderWithProviders(<Sidebar />, { route: '/dashboard' });
    const top = screen.getByRole('group', { name: 'Built modules' });
    expect(within(top).getByRole('link', { name: 'Change calendar' })).toBeInTheDocument();
    expect(within(top).getByRole('link', { name: 'Service levels' })).toBeInTheDocument();
  });
});
