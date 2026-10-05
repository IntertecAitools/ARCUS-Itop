"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GRAPH, type Node } from "@/content/graph-data";

type Pt = { x: number; y: number; vx: number; vy: number };

const W = 620;
const H = 460;
const SETTLE_MS = 3000;

export default function DependencyGraph() {
  const [pos, setPos] = useState<Record<string, Pt>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const raf = useRef<number | null>(null);

  // everything downstream of a node, found by walking the edges
  const downstream = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const n of GRAPH.nodes) {
      const seen = new Set<string>();
      const stack = [n.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const e of GRAPH.edges) {
          if (e.from === cur && !seen.has(e.to)) {
            seen.add(e.to);
            stack.push(e.to);
          }
        }
      }
      map[n.id] = [...seen];
    }
    return map;
  }, []);

  const lit = useMemo(() => {
    if (!selected) return null;
    return new Set([selected, ...(downstream[selected] ?? [])]);
  }, [selected, downstream]);

  // deterministic starting ring, so server and client agree before the sim runs
  useEffect(() => {
    const start: Record<string, Pt> = {};
    GRAPH.nodes.forEach((n, i) => {
      const a = (i / GRAPH.nodes.length) * Math.PI * 2;
      const r = n.tier === 0 ? 70 : n.tier === 1 ? 140 : 200;
      start[n.id] = { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
    });
    setPos(start);
  }, []);

  useEffect(() => {
    if (!Object.keys(pos).length) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const started = Date.now();
    let live = { ...pos };

    const step = () => {
      const next: Record<string, Pt> = {};
      for (const n of GRAPH.nodes) {
        const p = live[n.id];
        if (!p) continue;
        let fx = 0;
        let fy = 0;

        // push every pair apart
        for (const m of GRAPH.nodes) {
          if (m.id === n.id) continue;
          const q = live[m.id];
          if (!q) continue;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy || 1;
          const f = 900 / d2;
          fx += dx * f;
          fy += dy * f;
        }

        // pull linked nodes together
        for (const e of GRAPH.edges) {
          const other = e.from === n.id ? e.to : e.to === n.id ? e.from : null;
          if (!other) continue;
          const q = live[other];
          if (!q) continue;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 92) * 0.012;
          fx += (dx / d) * f * d * 0.1;
          fy += (dy / d) * f * d * 0.1;
        }

        // hold the shape in the frame
        fx += (W / 2 - p.x) * 0.006;
        fy += (H / 2 - p.y) * 0.006;

        const vx = n.id === dragging.current ? 0 : (p.vx + fx) * 0.82;
        const vy = n.id === dragging.current ? 0 : (p.vy + fy) * 0.82;
        next[n.id] =
          n.id === dragging.current
            ? p
            : {
                x: Math.max(28, Math.min(W - 28, p.x + vx)),
                y: Math.max(24, Math.min(H - 24, p.y + vy)),
                vx,
                vy,
              };
      }
      live = next;
      setPos(next);

      // stop burning CPU once it has settled
      if (!reduce && Date.now() - started < SETTLE_MS) {
        raf.current = requestAnimationFrame(step);
      }
    };

    if (reduce) {
      for (let i = 0; i < 180; i++) step();
    } else {
      raf.current = requestAnimationFrame(step);
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // run once, from the seeded layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(pos).length > 0]);

  const toLocal = useCallback((e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const p = toLocal(e);
    if (!p) return;
    setPos((old) => ({ ...old, [dragging.current!]: { ...old[dragging.current!], ...p, vx: 0, vy: 0 } }));
  };

  const byId = useMemo(() => Object.fromEntries(GRAPH.nodes.map((n) => [n.id, n])), []);
  const dim = (id: string) => (lit && !lit.has(id) ? 0.22 : 1);

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Interactive map of servers, applications and the business services that depend on them"
        onPointerMove={onMove}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
      >
        <g stroke="#243040" strokeWidth="1">
          {GRAPH.edges.map((e, i) => {
            const a = pos[e.from];
            const b = pos[e.to];
            if (!a || !b) return null;
            const on = lit?.has(e.from) && lit?.has(e.to);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={on ? "#3ddc97" : "#243040"}
                strokeOpacity={lit && !on ? 0.25 : 1}
              />
            );
          })}
        </g>

        {GRAPH.nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const on = lit?.has(n.id);
          const r = n.tier === 0 ? 9 : n.tier === 1 ? 7 : 5.5;
          return (
            <g
              key={n.id}
              opacity={dim(n.id)}
              className="cursor-pointer"
              onPointerDown={() => (dragging.current = n.id)}
              onClick={() => setSelected(selected === n.id ? null : n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={on ? "#3ddc97" : "#121821"}
                stroke={on ? "#3ddc97" : "#2d3a4d"}
                strokeWidth="1.5"
              />
              {(n.tier === 0 || hovered === n.id || on) && (
                <text
                  x={p.x + r + 6}
                  y={p.y + 4}
                  fontSize="11"
                  fill={on ? "#e8edf4" : "#9aa9bc"}
                  className="font-mono pointer-events-none"
                >
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex min-h-[48px] items-start gap-3 text-sm">
        {selected ? (
          <p className="text-ink-2">
            <span className="font-mono text-ink">{byId[selected].label}</span> —{" "}
            {downstream[selected].length === 0 ? (
              <>nothing depends on this. Safe to change.</>
            ) : (
              <>
                <span className="text-accent">{downstream[selected].length} things</span> stop if this
                goes down.
              </>
            )}{" "}
            <button onClick={() => setSelected(null)} className="focusable underline underline-offset-2">
              clear
            </button>
          </p>
        ) : (
          <p className="text-ink-3">
            Click any node to see what depends on it. Drag to move things around.
          </p>
        )}
      </div>
    </div>
  );
}
