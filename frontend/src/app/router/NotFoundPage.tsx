import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { buttonClasses, Card } from '@/components/ui';
import { HOME_PATH } from '@/config/modules';

export function NotFoundPage() {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-card bg-brand-soft text-brand">
          <Compass className="size-6" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-ink">Page not found</h1>
        <p className="mt-1.5 max-w-sm text-[13px] text-ink-secondary">
          That address doesn’t match any module. It may have been renamed, or the module hasn’t been
          registered yet.
        </p>
        <Link to={HOME_PATH} className={buttonClasses({ size: 'sm', className: 'mt-5' })}>
          Go to dashboard
        </Link>
      </div>
    </Card>
  );
}
