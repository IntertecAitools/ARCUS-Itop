'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { StatusPill } from '@/components/data-display';
import { priorityTone, ticketStatusTone } from '../schemas';
import type { TicketPriority } from '../types';

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useTranslation('tickets');
  return <Badge tone={priorityTone(priority)}>{t(`priority.${priority}`)}</Badge>;
}

export function TicketStatusPill({ status }: { status: string }) {
  const { t } = useTranslation('tickets');
  return <StatusPill tone={ticketStatusTone(status)} label={t(`status.${status}`, { defaultValue: status })} />;
}
