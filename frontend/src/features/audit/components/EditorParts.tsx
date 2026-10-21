import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui';

export const LABEL = 'mb-1.5 block text-[13px] font-medium text-ink';
export const HINT = 'mt-1 text-[12px] text-ink-muted';

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader title={title} {...(subtitle ? { subtitle } : {})} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
      {message}
    </div>
  );
}

/** The note shown while part of a check set up in iTop is kept. */
export function KeptCondition({ onRemove }: { onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary">
      <span>Also: a condition set up in iTop that cannot be shown here. It is kept as it is.</span>
      <button type="button" className="font-medium text-brand-ink hover:underline" onClick={onRemove}>
        Remove it
      </button>
    </div>
  );
}
