import type { RelationGraph } from '../types';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 40;
const COLUMN_GAP = 80;
const ROW_GAP = 14;
const PADDING = 16;

/**
 * How many records of one class, at one depth, before they fold into a single
 * box. iTop's impact view does the same ("group similar items") so a server
 * with forty virtual machines stays readable.
 */
export const GROUP_THRESHOLD = 5;

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
  /**
   * Set on a folded box standing for several records of the same class at the
   * same depth: their keys. Its `id` is 0; it opens nothing, it expands.
   */
  members?: string[];
}

export interface LayoutOptions {
  /** Fold a class at a depth once it has this many records. 0 never folds. */
  groupThreshold?: number;
  /** Groups (by key) the viewer opened, which are drawn record by record. */
  expanded?: ReadonlySet<string>;
}

/** The key of the box folding `className` records at `level`. */
export const groupKey = (level: number, className: string) => `group:${level}:${className}`;

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
 * of CI sit together. A class with `groupThreshold` or more records in one
 * column folds into one box with a count, unless its group is `expanded`.
 */
export function layoutGraph(graph: RelationGraph, options: LayoutOptions = {}): GraphLayout {
  const threshold = options.groupThreshold ?? GROUP_THRESHOLD;
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

  // Fold: each record's box is its own, or its class-at-this-depth group's.
  const buckets = new Map<string, string[]>();
  for (const [key, l] of level) {
    if (key === rootKey) continue;
    const group = groupKey(l, byKey.get(key)!.class);
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group)!.push(key);
  }
  const boxOf = new Map<string, string>();
  for (const [group, keys] of buckets) {
    const fold = threshold > 0 && keys.length >= threshold && !options.expanded?.has(group);
    for (const key of keys) boxOf.set(key, fold ? group : key);
    if (fold) {
      const cls = byKey.get(keys[0]!)!.class;
      byKey.set(group, { key: group, class: cls, id: 0, label: `${keys.length} × ${cls}` });
      level.set(group, level.get(keys[0]!)!);
    }
  }
  boxOf.set(rootKey, rootKey);
  const members = new Map<string, string[]>();
  for (const [key, box] of boxOf) {
    if (box === key) continue;
    if (!members.has(box)) members.set(box, []);
    members.get(box)!.push(key);
  }

  const columns = new Map<number, string[]>();
  for (const box of new Set(boxOf.values())) {
    const l = level.get(box)!;
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l)!.push(box);
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
        ...(members.has(key) ? { members: members.get(key)! } : {}),
      });
    });
  }

  // Edges between boxes: folded records share one arrow, and an edge inside a
  // group (two VMs of one host, say) has nowhere to go.
  const seen = new Set<string>();
  const edges: GraphLayout['edges'] = [];
  for (const e of graph.edges) {
    const from = boxOf.get(e.from);
    const to = boxOf.get(e.to);
    if (!from || !to || from === to || seen.has(`${from}
${to}`)) continue;
    seen.add(`${from}
${to}`);
    edges.push({ from: placed.get(from)!, to: placed.get(to)! });
  }

  const levels = columns.size;
  return {
    nodes: [...placed.values()],
    edges,
    width: PADDING * 2 + levels * NODE_WIDTH + Math.max(0, levels - 1) * COLUMN_GAP,
    height: PADDING * 2 + tallest * NODE_HEIGHT + Math.max(0, tallest - 1) * ROW_GAP,
    levels,
  };
}
