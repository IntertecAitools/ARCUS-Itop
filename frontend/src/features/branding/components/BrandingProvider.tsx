import { useEffect, type ReactNode } from 'react';
import { brandStylesheet } from '@/lib/branding/palette';
import { useBranding, useProductName } from '../api/branding.api';

const STYLE_ID = 'tenant-brand';

/**
 * Applies the site's branding: the accent colour re-points the brand (violet)
 * tokens through one generated stylesheet (contrast kept, lib/branding), and
 * the product name and logo reach the tab title and favicon. Renders nothing
 * of its own.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data } = useBranding();
  const name = useProductName();

  useEffect(() => {
    const css = data?.accentColor ? brandStylesheet(data.accentColor) : '';
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!css) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }, [data?.accentColor]);

  useEffect(() => {
    document.title = name.full;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    icon.dataset.default ??= icon.href;
    icon.href = name.logo ?? icon.dataset.default;
    icon.type = name.logo ? '' : 'image/svg+xml';
  }, [name.full, name.logo]);

  return <>{children}</>;
}
