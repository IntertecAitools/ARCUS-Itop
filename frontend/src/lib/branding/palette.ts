/**
 * A tenant's accent colour, turned into the brand tokens the redesign's
 * violet uses (styles/public-theme.css), for the dark and the light look.
 *
 * Any colour a customer picks must keep the redesign's contrast promises
 * (WCAG 2.1 AA), so each token is walked lighter or darker until it holds:
 * - white text on the brand fill (buttons, both ends of the gradient): ≥ 4.5:1;
 * - brand-coloured text (`brand-ink`) on the page: ≥ 4.5:1;
 * - the focus ring on the page: ≥ 3:1 (a non-text indicator).
 * A colour that already passes is used as it is.
 */

type Rgb = [number, number, number];

/** The pages the tokens sit on: near-black (dark) and the light canvas. */
export const SURFACES = { dark: '#0a0a10', light: '#ffffff' } as const;

export function parseHex(hex: string): Rgb | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a)!);
  const lb = luminance(parseHex(b)!);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mixes towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex)!;
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return toHex(rgb.map((c) => c + (target - c) * t) as Rgb);
}

/** The first shade, stepping one way, that reaches `ratio` against `against`. */
function untilContrast(hex: string, against: string, ratio: number, direction: 1 | -1): string {
  for (let step = 0; step <= 20; step++) {
    const candidate = shade(hex, direction * step * 0.05);
    if (contrast(candidate, against) >= ratio) return candidate;
  }
  return direction > 0 ? '#ffffff' : '#000000';
}

/** Mixes two colours: 0 is `a`, 1 is `b`. */
function mix(a: string, b: string, t: number): string {
  const x = parseHex(a)!;
  const y = parseHex(b)!;
  return toHex(x.map((c, i) => c + (y[i]! - c) * t) as Rgb);
}

export type BrandTokens = Record<
  | '--arcus-brand'
  | '--arcus-brand-hover'
  | '--arcus-brand-active'
  | '--arcus-brand-soft'
  | '--arcus-brand-soft-hover'
  | '--arcus-brand-ink'
  | '--arcus-ring'
  | '--arcus-on-brand'
  | '--arcus-brand-gradient',
  string
>;

/** The brand tokens for one mode, from an accent colour. Undefined for an invalid colour. */
export function brandTokens(accent: string, mode: 'dark' | 'light'): BrandTokens | undefined {
  if (!parseHex(accent)) return undefined;
  const surface = SURFACES[mode];
  // The fill carries white text, so it is darkened until white reads on it.
  const brand = untilContrast(accent, '#ffffff', 4.5, -1);
  const gradientTop = contrast(shade(brand, 0.1), '#ffffff') >= 4.5 ? shade(brand, 0.1) : brand;
  const gradientBottom = shade(brand, -0.2);
  const ink = untilContrast(accent, surface, 4.5, mode === 'dark' ? 1 : -1);
  const ring = untilContrast(accent, surface, 3, mode === 'dark' ? 1 : -1);
  return {
    '--arcus-brand': brand,
    '--arcus-brand-hover': mode === 'dark' ? untilContrast(shade(brand, 0.08), '#ffffff', 4.5, -1) : shade(brand, -0.12),
    '--arcus-brand-active': shade(brand, -0.22),
    '--arcus-brand-soft': mode === 'dark' ? mix(surface, accent, 0.16) : mix(surface, accent, 0.1),
    '--arcus-brand-soft-hover': mode === 'dark' ? mix(surface, accent, 0.24) : mix(surface, accent, 0.16),
    '--arcus-brand-ink': ink,
    '--arcus-ring': ring,
    '--arcus-on-brand': '#ffffff',
    '--arcus-brand-gradient': `linear-gradient(180deg, ${gradientTop} 0%, ${gradientBottom} 100%)`,
  };
}

/**
 * The stylesheet that re-points the brand tokens, under the same selectors
 * public-theme.css uses for each mode, so it wins by coming later.
 */
export function brandStylesheet(accent: string): string {
  const dark = brandTokens(accent, 'dark');
  const light = brandTokens(accent, 'light');
  if (!dark || !light) return '';
  const body = (t: BrandTokens) =>
    Object.entries(t)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
  return [
    `[data-public-theme='dark'],\n:root[data-theme='dark'] [data-public-theme='follow'] {\n${body(dark)}\n}`,
    `[data-public-theme='light'],\n:root:not([data-theme='dark']) [data-public-theme='follow'] {\n${body(light)}\n}`,
  ].join('\n');
}
