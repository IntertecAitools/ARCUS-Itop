import type { Blackout, CalendarChange, ChangeClash, ChangeStatus, NamedRef } from "./changes.types.js";

/** A change with no planned end is taken to last this long. */
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** States in which a change will not (or did not) happen: they clash with nothing. */
const INACTIVE: ChangeStatus[] = ["rejected", "not_approved"];

export function span(start: string, end: string): [number, number] {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : NaN;
  return [from, Number.isFinite(to) && to > from ? to : from + DEFAULT_DURATION_MS];
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * Two changes clash when they overlap in time and touch the same CI or the
 * same service. Fills `clashes` on each item, both ways.
 */
export function markClashes(items: CalendarChange[]): void {
  const active = items.filter((i) => i.start && !INACTIVE.includes(i.status));
  // Sorted by start, a change can only clash with the ones after it that start before it ends.
  active.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (let i = 0; i < active.length; i++) {
    const a = active[i]!;
    const sa = span(a.start, a.end);
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j]!;
      const sb = span(b.start, b.end);
      if (sb[0] >= sa[1]) break;
      if (!overlaps(sa, sb)) continue;
      const on = [
        ...shared(a.cis, b.cis).map((name) => ({ kind: "ci" as const, name })),
        ...shared(a.services, b.services).map((name) => ({ kind: "service" as const, name })),
      ];
      if (on.length === 0) continue;
      a.clashes.push({ changeId: b.id, ref: b.ref, on } satisfies ChangeClash);
      b.clashes.push({ changeId: a.id, ref: a.ref, on });
    }
  }
}

function shared(a: NamedRef[], b: NamedRef[]): string[] {
  const ids = new Set(b.map((r) => r.id));
  return a.filter((r) => ids.has(r.id)).map((r) => r.name);
}

/** The blackout windows a change runs into. */
export function blackoutsHit(item: Pick<CalendarChange, "start" | "end" | "status">, blackouts: Blackout[]): NamedRef[] {
  if (!item.start || INACTIVE.includes(item.status)) return [];
  const s = span(item.start, item.end);
  return blackouts
    .filter((b) => overlaps(s, [Date.parse(b.start), Date.parse(b.end)]))
    .map((b) => ({ id: b.id, name: b.name }));
}

/** Distinct values, sorted by name. */
export function distinct(refs: Iterable<NamedRef>): NamedRef[] {
  const map = new Map<string, NamedRef>();
  for (const r of refs) if (r.id && r.id !== "0") map.set(r.id, r);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
