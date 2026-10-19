import { describe, expect, it } from 'vitest';
import type { RelationGraph } from '../types';
import { layoutGraph } from './graph-layout';

const graph = (edges: Array<[string, string]>, extra: string[] = []): RelationGraph => {
  const keys = new Set([...edges.flat(), ...extra]);
  return {
    root: { class: 'Server', id: 1 },
    relation: 'impacts',
    direction: 'down',
    depth: 5,
    nodes: [...keys].map((key) => {
      const [cls, id] = key.split('::');
      return { key, class: cls!, id: Number(id), label: key };
    }),
    edges: edges.map(([from, to]) => ({ from, to })),
    message: '',
  };
};

describe('layoutGraph', () => {
  it('puts the record first and each hop one column further', () => {
    const layout = layoutGraph(
      graph([
        ['Server::1', 'VirtualMachine::2'],
        ['VirtualMachine::2', 'ApplicationSolution::3'],
      ]),
    );
    const level = Object.fromEntries(layout.nodes.map((n) => [n.key, n.level]));
    expect(level).toEqual({ 'Server::1': 0, 'VirtualMachine::2': 1, 'ApplicationSolution::3': 2 });
    expect(layout.nodes.find((n) => n.isRoot)?.key).toBe('Server::1');
    expect(layout.levels).toBe(3);
  });

  it('counts hops ignoring direction, so "depends on" lays out the same way', () => {
    const layout = layoutGraph(graph([['Rack::9', 'Server::1']]));
    expect(layout.nodes.find((n) => n.key === 'Rack::9')?.level).toBe(1);
  });

  it('keeps nodes that no edge reaches, after the rest', () => {
    const layout = layoutGraph(graph([['Server::1', 'VirtualMachine::2']], ['Person::7']));
    expect(layout.nodes.find((n) => n.key === 'Person::7')?.level).toBe(2);
  });

  it('adds the record itself when iTop did not return it', () => {
    const layout = layoutGraph({ ...graph([]), nodes: [] });
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]?.isRoot).toBe(true);
  });
});
