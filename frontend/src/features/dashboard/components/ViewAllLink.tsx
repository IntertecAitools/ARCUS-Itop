import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { isModuleRegistered } from '@/config/modules';

/**
 * The "View all →" affordance in a card header.
 *
 * Renders nothing when the target module isn't built yet, so the dashboard
 * never offers a link that dead-ends. Each link appears on its own the moment
 * its module is registered — no edit here needed.
 */
export function ViewAllLink({ to, label }: { to: string; label?: string }) {
  const { t } = useTranslation();
  if (!isModuleRegistered(to)) return null;

  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded text-[13px] font-medium text-brand-ink transition-colors hover:text-brand-hover"
    >
      {label ?? t('dashboard.viewAll')}
      <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}
