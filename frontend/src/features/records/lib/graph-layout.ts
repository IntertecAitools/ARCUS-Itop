import type { RelationGraph } from '../types';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 40;
const COLUMN_GAP = 80;
const ROW_GAP = 14;
const PADDING = 16;

export interface PlacedNode {
  key: string;
  class: string;
  id: number;
  label: string;
  /** Hops from the record the graph is about. */
  level: number;
  x: number;
  y: number;
  isRoot: boolean;
}

export interface GraphLayout {
  nodes: PlacedNode[];
  edges: Array<{ from: PlacedNode; to: PlacedNode }>;
  width: number;
  height: number;
  /** How many columns the graph spans, root included. */
  levels: number;
}

/**
 * Lays an impact graph out in columns: the record itself first, then every
 * record one hop away, then two, and so on. Hops are counted ignoring edge
 * direction, so "depends on" (whose edges point INTO the record) lays out
 * the same way as "impacts"; the arrows still show the real direction.
 *
 * Within a column, nodes are ordered by class, then label, so related kinds
 * of CI sit together.
 */
export function layoutGraph(graph: RelationGraph): GraphLayout {
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));

  // The record itself: iTop reports it under its real class, which can be a
  // subclass of the one in the URL, so match on id among the graph's nodes.
  const rootKey =
    graph.nodes.find((n) => n.class === graph.root.class && n.id === graph.root.id)?.key ??
    graph.nodes.find((n) => n.id === graph.root.id)?.key ??
    `${graph.root.class}::${graph.root.id}`;
  if (!byKey.has(rootKey)) {
    byKey.set(rootKey, { key: rootKey, class: graph.root.class, id: graph.root.id, label: `#${graph.root.id}` });
  }

  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const e of graph.edges) {
    if (!byKey.has(e.from) || !byKey.has(e.to)) continue;
    link(e.from, e.to);
    link(e.to, e.from);
  }

  const level = new Map<string, number>([[rootKey, 0]]);
  const queue = [rootKey];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighbours.get(current) ?? []) {
      if (!level.has(next)) {
        level.set(next, level.get(current)! + 1);
        queue.push(next);
      }
    }
  }
  // Anything iTop returned that no edge reaches still belongs on the page.
  const maxLevel = Math.max(0, ...level.values());
  for (const key of byKey.keys()) if (!level.has(key)) level.set(key, maxLevel + 1);

  const columns = new Map<number, string[]>();
  for (const [key, l] of level) {
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l)!.push(key);
  }

  const placed = new Map<string, PlacedNode>();
  let tallest = 0;
  for (const [l, keys] of [...columns].sort((a, b) => a[0] - b[0])) {
    keys.sort((a, b) => {
      const na = byKey.get(a)!;
      const nb = byKey.get(b)!;
      return na.class.localeCompare(nb.class) || na.label.localeCompare(nb.label);
    });
    tallest = Math.max(tallest, keys.length);
    keys.forEach((key, row) => {
      const node = byKey.get(key)!;
      placed.set(key, {
        ...node,
        level: l,
        x: PADDING + l * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
        isRoot: key === rootKey,
      });
    });
  }

  const levels = columns.size;
  return {
    nodes: [...placed.values()],
    edges: graph.edges
      .filter((e) => placed.has(e.from) && placed.has(e.to))
      .map((e) => ({ from: placed.get(e.from)!, to: placed.get(e.to)! })),
    width: PADDING * 2 + levels * NODE_WIDTH + Math.max(0, levels - 1) * COLUMN_GAP,
    height: PADDING * 2 + tallest * NODE_HEIGHT + Math.max(0, tallest - 1) * ROW_GAP,
    levels,
  };
}
