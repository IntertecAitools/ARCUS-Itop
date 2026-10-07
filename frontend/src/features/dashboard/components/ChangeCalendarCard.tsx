import { useState } from 'react';
import { addDays, format, isSameDay, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardBody, CardHeader, IconButton, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';
import { status } from '@/theme';
import type { ChangeEvent } from '../types';
import { ViewAllLink } from './ViewAllLink';

/** Risk is a reserved status role — icon-free here, but always labelled. */
const riskColor: Record<ChangeEvent['risk'], string> = {
  low: status.good,
  medium: status.warning,
  high: status.critical,
};

const riskLabel: Record<ChangeEvent['risk'], string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

export function ChangeCalendarCard({
  data,
  isLoading,
}: {
  data?: ChangeEvent[];
  isLoading: boolean;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [selected, setSelected] = useState(() => new Date());

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayEvents = (data ?? []).filter((e) => isSameDay(new Date(e.scheduledAt), selected));

  return (
    <Card className="h-full">
      <CardHeader title="Change Calendar" action={<ViewAllLink to="/changes" />} />
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <IconButton
            size="sm"
            label="Previous week"
            icon={<ChevronLeft className="size-4" />}
            onClick={() => setWeekStart((d) => addDays(d, -7))}
          />
          <p className="text-[13px] font-medium text-ink">{format(weekStart, 'MMMM yyyy')}</p>
          <IconButton
            size="sm"
            label="Next week"
            icon={<ChevronRight className="size-4" />}
            onClick={() => setWeekStart((d) => addDays(d, 7))}
          />
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const isSelected = isSameDay(day, selected);
            const hasEvents = (data ?? []).some((e) => isSameDay(new Date(e.scheduledAt), day));
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelected(day)}
                aria-pressed={isSelected}
                className={cn(
                  'relative flex flex-col items-center rounded-control py-2 transition-colors',
                  isSelected
                    ? 'bg-brand text-white'
                    : 'text-ink-secondary hover:bg-surface-hover',
                )}
              >
                <span className="text-[15px] leading-5 font-semibold tabular-nums">
                  {format(day, 'dd')}
                </span>
                <span
                  className={cn(
                    'text-[11px] leading-4',
                    isSelected ? 'text-white/80' : 'text-ink-muted',
                  )}
                >
                  {format(day, 'EEE')}
                </span>
                {hasEvents && !isSelected ? (
                  <span
                    className="absolute bottom-1 size-1 rounded-full bg-brand"
                    aria-label="has scheduled changes"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-2.5">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)
          ) : dayEvents.length === 0 ? (
            <EmptyState
              className="py-8"
              title="No changes scheduled"
              description={`Nothing is planned for ${format(selected, 'EEEE, dd MMM')}.`}
            />
          ) : (
            dayEvents.map((event) => (
              <div key={event.id} className="flex items-center gap-2.5 text-[13px]">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: riskColor[event.risk] }}
                  aria-hidden
                />
                <span className="sr-only">{riskLabel[event.risk]}.</span>
                <span className="shrink-0 font-medium text-brand-ink">{event.ref}</span>
                <span className="min-w-0 flex-1 truncate text-ink-secondary">{event.title}</span>
                <span className="shrink-0 text-ink-muted tabular-nums">
                  {format(new Date(event.scheduledAt), 'hh:mm a')}
                </span>
              </div>
            ))
          )}
        </div>
      </CardBody>
    </Card>
  );
}
