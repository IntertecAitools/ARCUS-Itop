import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { IconButton, Skeleton } from '@/components/ui';
import { cn, relativeTime } from '@/lib/utils';
import { useInbox, useMarkAllRead, useMarkRead, useUnreadCount } from '../api/inbox.api';
import type { InboxItem } from '../types';

const PRIORITY_DOT: Record<InboxItem['priority'], string> = {
  critical: 'bg-critical',
  high: 'bg-serious',
  medium: 'bg-warning',
  low: 'bg-neutral',
};

/** "9+" past nine: the badge is a nudge, not a ledger. */
export function badgeText(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/**
 * The bell: unread count, and a panel of the latest notifications. Clicking
 * one marks it read and opens what it is about, where `linkFor` says (the
 * agent screens and the portal open records in different places).
 */
export function NotificationBell({
  linkFor,
}: {
  linkFor: (record: NonNullable<InboxItem['record']>) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: unread = 0 } = useUnreadCount();
  const { data, isLoading, isError } = useInbox(open);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openItem = (item: InboxItem) => {
    if (!item.read) markRead.mutate(item.id);
    const to = item.record ? linkFor(item.record) : null;
    if (to) {
      setOpen(false);
      navigate(to);
    }
  };

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div className="relative" ref={ref}>
      <IconButton
        label={label}
        icon={<Bell className="size-[18px]" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {unread > 0 ? (
        <span
          className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-[color:var(--arcus-surface)]"
          aria-hidden
        >
          {badgeText(unread)}
        </span>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-line bg-surface-raised shadow-overlay"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="text-[13px] font-semibold text-ink">
              Notifications{unread ? <span className="ml-1.5 text-ink-muted">{unread} unread</span> : null}
            </p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-[12px] font-medium text-brand-ink hover:bg-surface-hover"
              >
                <CheckCheck className="size-3.5" aria-hidden />
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : isError ? (
              <p className="px-3 py-6 text-center text-[13px] text-critical-ink">Notifications could not be loaded.</p>
            ) : !data?.items.length ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink-muted">You’re all caught up.</p>
            ) : (
              <ul>
                {data.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={cn(
                        'flex w-full gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-hover',
                        !item.read && 'bg-brand-soft/40',
                      )}
                    >
                      <span
                        className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.read ? 'bg-transparent' : PRIORITY_DOT[item.priority])}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-[13px] text-ink', !item.read && 'font-semibold')}>
                          {item.title}
                        </span>
                        {item.message ? (
                          <span className="block text-[12px] text-ink-secondary">{item.message}</span>
                        ) : null}
                        <span className="mt-0.5 block text-[11px] text-ink-muted">
                          {relativeTime(item.date)}
                          {item.read ? '' : ' · unread'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
