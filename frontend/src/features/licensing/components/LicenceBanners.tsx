import { AlertTriangle, Info, Lock } from 'lucide-react';
import { useLicenceStatus } from '../api/licensing.api';
import type { LicenceBanner } from '../types';

const TONE: Record<LicenceBanner['tone'], string> = {
  info: 'border-info/30 bg-info-soft text-info-ink',
  warning: 'border-warning/30 bg-warning-soft text-warning-ink',
  danger: 'border-critical/30 bg-critical-soft text-critical-ink',
};

const ICON: Record<LicenceBanner['tone'], typeof Info> = { info: Info, warning: AlertTriangle, danger: Lock };

/**
 * The licence banners for this user, from GET /api/licence/status: expiring
 * soon (administrators), grace, read-only and evaluation (every agent), and
 * non-production (everyone, on every page). Nothing when licensing is off.
 */
export function LicenceBanners({ className }: { className?: string }) {
  const { data } = useLicenceStatus();
  const banners = data?.banners ?? [];
  if (!banners.length) return null;
  return (
    <div className={className} data-testid="licence-banners">
      {banners.map((b) => {
        const Icon = ICON[b.tone];
        return (
          <p
            key={b.kind}
            role={b.tone === 'danger' ? 'alert' : 'status'}
            data-kind={b.kind}
            className={`flex items-start gap-2 border-b px-4 py-2 text-[13px] leading-5 ${TONE[b.tone]}`}
          >
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{b.message}</span>
          </p>
        );
      })}
    </div>
  );
}
