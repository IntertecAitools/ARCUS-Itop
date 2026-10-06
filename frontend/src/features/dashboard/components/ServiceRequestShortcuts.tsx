import { Link } from 'react-router-dom';
import { Boxes, Laptop, Mail, Settings, UserRound } from 'lucide-react';
import { buttonClasses, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { isModuleRegistered } from '@/config/modules';
import type { CatalogShortcut } from '../types';
import { ViewAllLink } from './ViewAllLink';

/**
 * The API ships an icon NAME, never a component — so the catalogue stays a
 * data concern and the UI keeps control of what the icons look like.
 */
const icons = {
  access: UserRound,
  hardware: Laptop,
  software: Settings,
  email: Mail,
} as const;

export function ServiceRequestShortcuts({
  data,
  isLoading,
}: {
  data?: CatalogShortcut[];
  isLoading: boolean;
}) {
  const catalogReady = isModuleRegistered('/service-catalog');

  return (
    <Card className="h-full">
      <CardHeader title="Service Requests" action={<ViewAllLink to="/service-catalog" />} />
      <CardBody>
        {isLoading || !data ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[168px]" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<Boxes className="size-5" />}
            title="No catalogue items"
            description="Publish services in the catalogue to offer them here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.map((shortcut) => {
              const Icon = icons[shortcut.icon];
              return (
                <div
                  key={shortcut.id}
                  className="flex flex-col items-center rounded-card border border-line bg-surface p-3 text-center transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
                >
                  <span className="mb-2.5 flex size-10 items-center justify-center rounded-control bg-brand-soft text-brand">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <p className="text-[12.5px] leading-4 font-semibold text-balance text-ink">
                    {shortcut.label}
                  </p>
                  <p className="mt-1 mb-3 text-[11.5px] leading-4 text-balance text-ink-muted">
                    {shortcut.description}
                  </p>
                  {/* The button only appears once the catalogue module can
                      actually take the request. */}
                  {catalogReady ? (
                    <Link
                      to={`/service-catalog/new?item=${shortcut.id}`}
                      className={buttonClasses({
                        variant: 'secondary',
                        size: 'sm',
                        fullWidth: true,
                        className: 'mt-auto px-2 text-[12px] whitespace-nowrap',
                      })}
                    >
                      Create
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
