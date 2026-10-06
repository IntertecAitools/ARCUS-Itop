import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { modules } from '@/config/modules';
import { useUiStore } from '@/stores/ui.store';

/**
 * Ctrl/⌘-K navigation.
 *
 * Entries come from the module registry, so a new module becomes searchable the
 * moment it is registered — there is no second list to keep in sync. Modules
 * will later contribute record-level results (a ticket by ref) through the
 * search feature; the shell only owns the navigation half.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.path.includes(q),
    );
  }, [query]);

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
    navigate(`/${path}`);
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
                <li key={m.id} role="option" aria-selected={active}>
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
