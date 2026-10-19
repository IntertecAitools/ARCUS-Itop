import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { useImpact } from '../api/useRecords';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from '../lib/graph-layout';
import { CONTROL } from './FieldControls';

/**
 * Impact analysis, iTop's "Impacts" / "Depends on" graph for a CI.
 *
 * "Impacts" follows iTop's `impacts` relation downwards: what breaks if this
 * CI does. "Depends on" follows it upwards: what this CI needs. The BFF calls
 * core/get_related; this draws the result, the record in the first column
 * and each further column one hop away. Every box opens its record.
 */
export function ImpactTab({ className, id }: { className: string; id: string }) {
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [depth, setDepth] = useState(5);
  const { data, isLoading, isError, error } = useImpact(className, id, direction, depth);
  const layout = useMemo(() => (data ? layoutGraph(data) : null), [data]);
  const navigate = useNavigate();

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex rounded-control border border-line p-0.5" role="group" aria-label="Direction">
            {(
              [
                ['down', 'Impacts'],
                ['up', 'Depends on'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={direction === value}
                onClick={() => setDirection(value)}
                className={cn(
                  'rounded-control px-3 py-1 text-[13px]',
                  direction === value ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-secondary hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            Depth
            <select
              className={cn(CONTROL, 'w-auto appearance-none')}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            >
              {[1, 2, 3, 5, 10, 20].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          {layout ? (
            <span className="text-[12px] text-ink-muted">
              {layout.nodes.length - 1} related record{layout.nodes.length === 2 ? '' : 's'}
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : isError ? (
          <div
            role="alert"
            className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
          >
            Couldn’t load the impact analysis. {error instanceof Error ? error.message : ''}
          </div>
        ) : !layout || layout.nodes.length <= 1 ? (
          <EmptyState
            title={direction === 'down' ? 'Nothing is impacted' : 'Depends on nothing'}
            description={
              direction === 'down'
                ? 'No other record is affected if this one fails.'
                : 'iTop records no dependency for this record.'
            }
          />
        ) : (
          <div className="overflow-auto rounded-card border border-line bg-surface">
            <svg
              width={layout.width}
              height={layout.height}
              role="img"
              aria-label={`${direction === 'down' ? 'Impact' : 'Dependency'} graph`}
            >
              <defs>
                <marker id="impact-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="fill-ink-muted" />
                </marker>
              </defs>
              {layout.edges.map(({ from, to }, i) => {
                // Leave each box from the side facing the other one.
                const forward = to.x >= from.x;
                const x1 = forward ? from.x + NODE_WIDTH : from.x;
                const x2 = forward ? to.x : to.x + NODE_WIDTH;
                const y1 = from.y + NODE_HEIGHT / 2;
                const y2 = to.y + NODE_HEIGHT / 2;
                const bend = Math.max(30, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
                return (
                  <path
                    key={i}
                    d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
                    fill="none"
                    className="stroke-line-strong"
                    strokeWidth={1.25}
                    markerEnd="url(#impact-arrow)"
                  />
                );
              })}
              {layout.nodes.map((node) => (
                <g
                  key={node.key}
                  transform={`translate(${node.x},${node.y})`}
                  role="link"
                  tabIndex={0}
                  aria-label={`${node.label} (${node.class})`}
                  className="cursor-pointer"
                  onClick={() => navigate(`/records/${node.class}/${node.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/records/${node.class}/${node.id}`);
                  }}
                >
                  <title>{`${node.label} — ${node.class}`}</title>
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    className={node.isRoot ? 'fill-brand-soft stroke-brand' : 'fill-surface-raised stroke-line hover:stroke-brand'}
                    strokeWidth={node.isRoot ? 1.5 : 1}
                  />
                  <text x={10} y={17} className="fill-ink text-[12px] font-medium">
                    {truncate(node.label, 26)}
                  </text>
                  <text x={10} y={31} className="fill-ink-muted text-[10px]">
                    {node.class}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
