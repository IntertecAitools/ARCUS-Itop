'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import type { Tone } from '@/theme';
import type { KnownErrorDomain } from '../types';

const domainTones: Record<KnownErrorDomain, Tone> = {
  Network: 'info',
  Server: 'purple',
  Application: 'warning',
  Desktop: 'neutral',
};

export function DomainBadge({ domain }: { domain: KnownErrorDomain }) {
  const { t } = useTranslation('knowledgeBase');
  return <Badge tone={domainTones[domain]}>{t(`domain.${domain}`)}</Badge>;
}
