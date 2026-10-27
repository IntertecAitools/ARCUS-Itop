import { useQuery } from '@tanstack/react-query';
import { PendingNote } from '@/components/data-display';
import { apiClient } from '@/lib/api-client';
import type { PendingInfo } from '@/types/ticket';

/**
 * A ticket on hold: why, and when someone acts on it again. The generic
 * record reads no platform-only fields, so this asks for them itself; keyed
 * on the status, so it reads again when the ticket moves on or off hold.
 */
export function PendingBanner({ className, id, status }: { className: string; id: string; status: string }) {
  const { data } = useQuery({
    queryKey: ['ticket-pending', className, id, status],
    queryFn: () =>
      apiClient.get<{ pending: PendingInfo | null; extrasAvailable: boolean }>(`/tickets/${className}/${id}/pending`),
    enabled: status === 'pending',
  });
  const pending = status === 'pending' ? data?.pending : null;
  if (!pending) return null;
  return (
    <div
      role={pending.overdue ? 'alert' : 'status'}
      className={
        pending.overdue
          ? 'mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3'
          : 'mb-4 rounded-card border border-line bg-surface-sunken px-4 py-3'
      }
    >
      <p className="mb-1 text-[12px] font-semibold tracking-wide text-ink-secondary uppercase">On hold</p>
      <PendingNote pending={pending} className="text-[13px]" />
    </div>
  );
}
