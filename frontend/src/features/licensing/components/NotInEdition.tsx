import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PackageX } from 'lucide-react';
import { buttonClasses, Card } from '@/components/ui';
import { HOME_PATH } from '@/config/modules';
import { useEditionFeatures, useEditionFor } from '../api/licensing.api';
import type { Feature } from '../types';

/**
 * What a user sees when they follow a link to something their edition does
 * not include: a short page, not an error. Data is never deleted; it comes
 * back if the edition is upgraded.
 */
export function NotInEdition({ feature }: { feature?: Feature }) {
  const { includedIn, current } = useEditionFor(feature);
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-card bg-brand-soft text-brand">
          <PackageX className="size-6" aria-hidden />
        </span>
        <h1 className="display text-[28px] text-ink">Not included in your edition</h1>
        <p className="mt-1.5 max-w-sm text-[13px] text-ink-secondary">
          {includedIn ? `This is part of the ${includedIn} edition` : 'This is part of another edition'}
          {current ? `; your organisation has ${current}.` : '.'} An administrator can ask about upgrading.
        </p>
        <Link to={HOME_PATH} className={buttonClasses({ size: 'sm', className: 'mt-5' })}>
          Go to dashboard
        </Link>
      </div>
    </Card>
  );
}

/** Renders its children only when the edition includes `feature` (always when nothing is enforced). */
export function EditionGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const features = useEditionFeatures();
  if (features && !features.has(feature)) return <NotInEdition feature={feature} />;
  return <>{children}</>;
}
