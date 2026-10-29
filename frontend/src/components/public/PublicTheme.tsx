import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';

/**
 * The root of every public screen (landing, sign-in, portal).
 *
 * Setting `data-public-theme` re-points the design tokens to the public look
 * (styles/public-theme.css), so everything inside — shared components included
 * — turns deep green, square and light-weight, while the staff app, which never
 * renders this, keeps its own look.
 */
export function PublicTheme({
  children,
  className,
  follow = false,
}: {
  children?: ReactNode;
  className?: string;
  /**
   * The staff shell: take dark or light from the staff theme preference
   * (`<html data-theme>`, kept by ThemeProvider) instead of the public switch.
   */
  follow?: boolean;
}) {
  const theme = useUiStore((s) => s.publicTheme);
  return (
    <div data-public-theme={follow ? 'follow' : theme} className={cn('min-h-screen bg-canvas text-ink', className)}>
      {children}
    </div>
  );
}

/** Dark ↔ light. The light variant is there for long reading and forms. */
export function PublicThemeToggle({ className }: { className?: string }) {
  const theme = useUiStore((s) => s.publicTheme);
  const setTheme = useUiStore((s) => s.setPublicTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink',
        className,
      )}
    >
      {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
