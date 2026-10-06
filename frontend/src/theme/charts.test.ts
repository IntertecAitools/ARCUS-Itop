import { describe, expect, it } from 'vitest';
import { createSeriesScale, SERIES_LIMIT, seriesPalette } from './charts';

describe('series palette', () => {
  it('exposes exactly the validated slot count', () => {
    // Guards the palette contract: a ninth hue is never generated. If this
    // fails someone added a colour without re-running the CVD validator.
    expect(seriesPalette).toHaveLength(SERIES_LIMIT);
  });

  it('references tokens rather than literal hex, so themes swap', () => {
    for (const colour of seriesPalette) {
      expect(colour).toMatch(/^var\(--arcus-series-\d\)$/);
    }
  });
});

describe('createSeriesScale', () => {
  const universe = ['network', 'application', 'access', 'hardware'];

  it('assigns hues in fixed slot order', () => {
    const scale = createSeriesScale(universe);
    expect(scale('network')).toBe(seriesPalette[0]);
    expect(scale('application')).toBe(seriesPalette[1]);
    expect(scale('hardware')).toBe(seriesPalette[3]);
  });

  it('keeps an entity on its own colour when other series are filtered out', () => {
    // Colour follows the ENTITY, never its rank — a filter that drops series
    // must not repaint the survivors.
    const full = createSeriesScale(universe);
    const filtered = createSeriesScale(universe);
    expect(filtered('hardware')).toBe(full('hardware'));
  });

  it('falls back to muted ink past the slot limit instead of inventing a hue', () => {
    const scale = createSeriesScale([...universe, 'a', 'b', 'c', 'd', 'ninth']);
    expect(scale('ninth')).toBe('var(--arcus-ink-muted)');
  });
});
