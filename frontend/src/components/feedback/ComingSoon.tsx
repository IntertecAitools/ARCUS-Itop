import type { ReactNode } from 'react';
import { Hourglass } from 'lucide-react';
import { EmptyState } from './EmptyState';

/** Shared placeholder for nav items whose module is not built yet. */
export function ComingSoon({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <EmptyState icon={Hourglass} title={title} description={description} action={action} />
    </div>
  );
}
