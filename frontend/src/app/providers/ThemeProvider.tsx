import { useEffect, type ReactNode } from 'react';
import { useUiStore } from '@/stores/ui.store';

/**
 * Keeps `<html data-theme>` in sync with the stored preference.
 *
 * Theming is a single attribute flip: every token is a CSS variable scoped to
 * `:root[data-theme]`, so nothing re-renders and no component reads the theme.
 * `index.html` applies the same value before first paint to avoid a white flash.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme;
      root.dataset.theme = resolved;
    };

    apply();
    localStorage.setItem('arcus.theme', theme);

    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return <>{children}</>;
}
