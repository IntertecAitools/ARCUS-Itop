/**
 * Saving a drawn graph as PNG or PDF, entirely in the browser.
 *
 * The graph is an <svg> styled by Tailwind classes, which an image of it would
 * not carry, so each element's computed colours and fonts are copied onto a
 * clone first. The clone is drawn onto a canvas (at 2x, so text stays sharp),
 * and the canvas becomes the PNG, or the single page of the PDF.
 */

/** Presentation properties the graph's classes set, copied as inline style. */
const STYLED = [
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
] as const;

/** A standalone SVG document of `svg` that looks the same outside the page. */
export function serializeSvg(svg: SVGSVGElement, background: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = [svg, ...svg.querySelectorAll('*')];
  const target = [clone, ...clone.querySelectorAll('*')];
  source.forEach((element, i) => {
    const style = getComputedStyle(element);
    const copy = target[i] as SVGElement;
    const inline = STYLED.map((p) => [p, style.getPropertyValue(p)] as const)
      .filter(([, v]) => v)
      .map(([p, v]) => `${p}:${v}`)
      .join(';');
    if (inline) copy.setAttribute('style', inline);
    copy.removeAttribute('class');
  });

  // The graph sets its size in pixels as attributes; the clone keeps them.
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // The page's background, under everything, so dark mode exports as seen.
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  backdrop.setAttribute('width', '100%');
  backdrop.setAttribute('height', '100%');
  backdrop.setAttribute('style', `fill:${background}`);
  clone.insertBefore(backdrop, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

/** The colour behind the graph: its container's, or white when transparent. */
function backgroundOf(svg: SVGSVGElement): string {
  for (let el: Element | null = svg; el; el = el.parentElement) {
    const colour = getComputedStyle(el).backgroundColor;
    if (colour && colour !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(colour)) return colour;
  }
  return '#ffffff';
}

async function toCanvas(svg: SVGSVGElement, scale = 2): Promise<HTMLCanvasElement> {
  const xml = serializeSvg(svg, backgroundOf(svg));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(image.width * scale);
  canvas.height = Math.ceil(image.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the graph to an image.');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);
  return canvas;
}

function save(href: string, filename: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
}

export async function downloadPng(svg: SVGSVGElement, filename: string) {
  const canvas = await toCanvas(svg);
  save(canvas.toDataURL('image/png'), filename);
}

/** One page sized to the graph, in its own orientation. */
export function pdfPage(width: number, height: number) {
  return { orientation: width >= height ? ('landscape' as const) : ('portrait' as const), format: [width, height] };
}

export async function downloadPdf(svg: SVGSVGElement, filename: string) {
  const canvas = await toCanvas(svg);
  const width = canvas.width / 2;
  const height = canvas.height / 2;
  // Loaded on demand: most people never export, and jsPDF is not small.
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'px', hotfixes: ['px_scaling'], ...pdfPage(width, height) });
  // 'FAST' deflates the pixels; without it jsPDF stores them raw (~10x larger).
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height, undefined, 'FAST');
  pdf.save(filename);
}
