import type { NavEntry, NavGroup } from '../types';
import { entryPath } from '../api/useNavigation';

/**
 * Which navigation entry is "the page you are on" — at most one.
 *
 * A filtered view and its plain list share a path and differ only by
 * `?view=`, so matching on the path (what NavLink does) lit up every view of
 * a class at once. Here the path AND the view must match. An address with a
 * view no entry names lights nothing; the plain list only answers when the
 * address has no view. Other query parameters (paging, search) are ignored.
 */
export function activeEntryId(groups: NavGroup[], pathname: string, search: string): string | null {
  const view = new URLSearchParams(search).get('view');
  let best: { entry: NavEntry; rank: number } | null = null;

  for (const group of groups) {
    for (const entry of group.entries) {
      const target = new URL(entryPath(entry), 'http://x');
      if (decodeURIComponent(target.pathname) !== decodeURIComponent(pathname)) continue;
      if (target.searchParams.get('view') !== view) continue;
      // The same address can be offered twice (a class's list and its search
      // page); the list wins, so exactly one item lights.
      const rank = entry.kind === 'list' ? 0 : entry.kind === 'search' ? 2 : 1;
      if (!best || rank < best.rank) best = { entry, rank };
    }
  }
  return best?.entry.id ?? null;
}

/** The group holding the active entry, if any. */
export function activeGroupId(groups: NavGroup[], activeId: string | null): string | null {
  if (!activeId) return null;
  return groups.find((g) => g.entries.some((e) => e.id === activeId))?.id ?? null;
}
