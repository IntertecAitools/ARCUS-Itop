import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, List, Plus, Search, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigableModules } from '@/config/modules';
import { entryPath, useNavigation } from '@/features/navigation';
import { useUiStore } from '@/stores/ui.store';

/**
 * Ctrl/⌘-K navigation.
 *
 * Two sources, neither of them a hand-written list: the modules we built, and
 * iTop's own navigation as published by the BFF. The second matters more than
 * it looks — most screens are now reached through iTop's tree, where finding
 * something means expanding the right group. Typing its name is faster, and it
 * is the only flat view of all ~40 entries.
 *
 * Modules will later contribute record-level results (a ticket by ref) through
 * the search feature; the shell only owns the navigation half.
 */
interface PaletteItem {
  key: string;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
}

const KIND_ICON: Record<string, LucideIcon> = {
  create: Plus,
  search: Search,
  list: List,
};

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  // Already cached by the sidebar, so this costs nothing extra.
  const { data: navigation } = useNavigation();

  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    const built: PaletteItem[] = navigableModules().map((m) => ({
      key: `module:${m.id}`,
      label: m.label,
      description: m.description,
      path: `/${m.path}`,
      icon: m.icon,
    }));

    const itop: PaletteItem[] = (navigation?.groups ?? []).flatMap((group) =>
      group.entries.map((entry) => ({
        key: `nav:${group.id}:${entry.id}`,
        label: entry.label,
        // The group is what disambiguates: several groups have an entry called
        // "Open", and the label alone would not say which one.
        description: `${group.label} · ${entry.class}`,
        path: entryPath(entry),
        icon: KIND_ICON[entry.kind] ?? List,
      })),
    );

    return [...built, ...itop];
  }, [navigation]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlighted(0);
      // Focus after paint, otherwise the dialog isn't in the DOM yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setHighlighted(0), [query]);

  if (!open) return null;

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % Math.max(results.length, 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => (i - 1 + results.length) % Math.max(results.length, 1));
    }
    if (e.key === 'Enter' && results[highlighted]) {
      e.preventDefault();
      go(results[highlighted].path);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[color:var(--arcus-ink)]/25 px-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and navigate"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-panel border border-line bg-surface-raised shadow-overlay"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-ink-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a module, or search tickets…"
            className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <kbd className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-ink-muted">
            Esc
          </kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-ink-muted">
              No module matches “{query}”.
            </li>
          ) : (
            results.map((m, i) => {
              const Icon = m.icon;
              const active = i === highlighted;
              return (
                <li key={m.key} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => go(m.path)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors',
                      active ? 'bg-brand-soft' : 'hover:bg-surface-hover',
                    )}
                  >
                    <Icon
                      className={cn('size-4 shrink-0', active ? 'text-brand' : 'text-ink-muted')}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {m.label}
                      </span>
                      <span className="block truncate text-[12px] text-ink-muted">
                        {m.description}
                      </span>
                    </span>
                    {active ? (
                      <CornerDownLeft className="size-3.5 shrink-0 text-brand" aria-hidden />
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
