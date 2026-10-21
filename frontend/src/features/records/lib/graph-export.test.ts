import { describe, expect, it } from 'vitest';
import { pdfPage, serializeSvg } from './graph-export';

describe('serializeSvg', () => {
  it('makes a standalone SVG: namespace, size, backdrop, no page classes', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<svg width="300" height="120"><g class="cursor-pointer"><rect class="fill-surface-raised" width="10" height="10"></rect><text class="fill-ink">Web 01</text></g></svg>';
    document.body.append(host);
    const xml = serializeSvg(host.querySelector('svg')!, 'rgb(1, 2, 3)');
    expect(xml).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(xml).toMatch(/^<svg [^>]*width="300"[^>]*height="120"/);
    // A backdrop in the page's colour comes first, under everything.
    expect(xml).toMatch(/^<svg [^>]*><rect width="100%" height="100%" style="fill:rgb\(1, 2, 3\)"/);
    expect(xml).not.toContain('class=');
    expect(xml).toContain('Web 01');
    // The page's SVG is untouched.
    expect(host.querySelector('rect')?.getAttribute('class')).toBe('fill-surface-raised');
    host.remove();
  });
});

describe('pdfPage', () => {
  it('sizes the page to the graph, in its orientation', () => {
    expect(pdfPage(800, 300)).toEqual({ orientation: 'landscape', format: [800, 300] });
    expect(pdfPage(200, 900)).toEqual({ orientation: 'portrait', format: [200, 900] });
  });
});
