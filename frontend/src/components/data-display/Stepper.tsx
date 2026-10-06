import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  id: string;
  label: string;
}

/** Horizontal lifecycle stepper; every step before `currentId` is complete. */
export function Stepper({ steps, currentId, label }: { steps: Step[]; currentId: string; label: string }) {
  const currentIndex = steps.findIndex((s) => s.id === currentId);
  return (
    <ol aria-label={label} className="flex items-center gap-2 overflow-x-auto">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <li key={step.id} className="flex flex-1 items-center gap-2" aria-current={current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                done && 'border-primary bg-primary text-white',
                current && 'border-primary bg-primary-soft text-primary',
                !done && !current && 'border-border bg-surface text-text-muted',
              )}
            >
              {done ? <Check className="size-4" aria-hidden /> : index + 1}
            </span>
            <span className={cn('text-sm whitespace-nowrap', current ? 'font-semibold text-text' : 'text-text-muted')}>
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <span className={cn('h-0.5 min-w-6 flex-1 rounded', done ? 'bg-primary' : 'bg-border')} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
