import { describe, expect, it } from 'vitest';
import { brandStylesheet, brandTokens, contrast, SURFACES } from './palette';

const ACCENTS = ['#6d4aff', '#0ea5e9', '#facc15', '#22c55e', '#ef4444', '#111111', '#ffffff', '#ff00ff'];

describe('brand tokens from an accent colour', () => {
  it.each(ACCENTS)('keeps AA contrast for %s in both modes', (accent) => {
    for (const mode of ['dark', 'light'] as const) {
      const t = brandTokens(accent, mode)!;
      expect(contrast(t['--arcus-on-brand'], t['--arcus-brand'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--arcus-on-brand'], t['--arcus-brand-hover'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--arcus-brand-ink'], SURFACES[mode])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--arcus-ring'], SURFACES[mode])).toBeGreaterThanOrEqual(3);
      for (const stop of t['--arcus-brand-gradient'].match(/#[0-9a-f]{6}/g)!) {
        expect(contrast('#ffffff', stop)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('uses a colour that already passes as it is', () => {
    expect(brandTokens('#5126d9', 'light')!['--arcus-brand']).toBe('#5126d9');
  });

  it('ignores a colour that is not a hex colour', () => {
    expect(brandTokens('violet', 'dark')).toBeUndefined();
    expect(brandStylesheet('url(javascript:alert(1))')).toBe('');
  });

  it('writes one rule per mode under the theme selectors', () => {
    const css = brandStylesheet('#0ea5e9');
    expect(css).toContain("[data-public-theme='dark']");
    expect(css).toContain(":root:not([data-theme='dark']) [data-public-theme='follow']");
    expect(css.match(/--arcus-brand:/g)).toHaveLength(2);
  });
});
