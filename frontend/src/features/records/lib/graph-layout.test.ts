import { describe, expect, it } from 'vitest';
import type { RelationGraph } from '../types';
import { groupKey, layoutGraph } from './graph-layout';

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

  describe('grouping', () => {
    // A server hosting six VMs, two of which run the same application.
    const vms = [2, 3, 4, 5, 6, 7].map((n) => `VirtualMachine::${n}`);
    const busy = graph([
      ...vms.map((vm) => ['Server::1', vm] as [string, string]),
      ['VirtualMachine::2', 'ApplicationSolution::9'],
      ['VirtualMachine::3', 'ApplicationSolution::9'],
      ['Server::1', 'Rack::8'],
    ]);

    it('folds a class with many records at one depth into one box with a count', () => {
      const layout = layoutGraph(busy);
      const group = layout.nodes.find((n) => n.key === groupKey(1, 'VirtualMachine'));
      expect(group?.members).toEqual(expect.arrayContaining(vms));
      expect(group?.members).toHaveLength(6);
      expect(group?.label).toBe('6 × VirtualMachine');
      expect(layout.nodes.some((n) => n.key === 'VirtualMachine::2')).toBe(false);
      // The lone rack and the application stay as they are.
      expect(layout.nodes.find((n) => n.key === 'Rack::8')?.members).toBeUndefined();
      expect(layout.nodes.map((n) => n.key)).toContain('ApplicationSolution::9');
    });

    it('draws one arrow per pair of boxes, not one per folded record', () => {
      const layout = layoutGraph(busy);
      const pairs = layout.edges.map((e) => `${e.from.key}>${e.to.key}`);
      expect(pairs.sort()).toEqual(
        [
          `Server::1>${groupKey(1, 'VirtualMachine')}`,
          'Server::1>Rack::8',
          `${groupKey(1, 'VirtualMachine')}>ApplicationSolution::9`,
        ].sort(),
      );
    });

    it('draws an expanded group record by record', () => {
      const layout = layoutGraph(busy, { expanded: new Set([groupKey(1, 'VirtualMachine')]) });
      expect(layout.nodes.filter((n) => n.class === 'VirtualMachine')).toHaveLength(6);
      expect(layout.nodes.some((n) => n.members)).toBe(false);
      expect(layout.edges).toHaveLength(9);
    });

    it('leaves classes under the threshold, and everything when grouping is off', () => {
      expect(layoutGraph(busy, { groupThreshold: 7 }).nodes.some((n) => n.members)).toBe(false);
      expect(layoutGraph(busy, { groupThreshold: 0 }).nodes).toHaveLength(9);
    });

    it('never folds the record itself', () => {
      const layout = layoutGraph(busy, { groupThreshold: 1 });
      expect(layout.nodes.find((n) => n.isRoot)?.key).toBe('Server::1');
    });
  });
});
