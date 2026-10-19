import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useCatalog, useCreateRequest } from '../api/portal.api';

const CONTROL =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none';

const URGENCY = [
  { value: '4', label: 'Low — whenever possible' },
  { value: '3', label: 'Medium — it slows me down' },
  { value: '2', label: 'High — I am mostly blocked' },
  { value: '1', label: 'Critical — I cannot work' },
];

/**
 * Raise a request: pick what it is about from the catalogue of services
 * the user's organisation is contracted for, then describe it. Files can be
 * attached on the request page once it exists.
 */
export function PortalNewRequestPage() {
  const navigate = useNavigate();
  const { data: services, isLoading } = useCatalog();
  const create = useCreateRequest();
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('4');

  const families = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof services>>();
    for (const s of services ?? []) {
      const key = s.family || 'Other services';
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()];
  }, [services]);
  const service = services?.find((s) => s.id === serviceId);

  const submit = () =>
    create.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        urgency,
        ...(serviceId ? { serviceId } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
      },
      { onSuccess: (ticket) => navigate(`/portal/requests/${ticket.id}`, { replace: true }) },
    );

  return (
    <>
      <h1 className="mb-4 text-[20px] font-semibold text-ink">New request</h1>
      {create.isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {(create.error as Error).message}
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader title="1. What is it about?" subtitle="Choose a service, or skip this if none fits." />
        <CardBody>
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : families.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No services are listed for your organisation. Describe your request below.</p>
          ) : (
            <div className="space-y-4">
              {families.map(([family, items]) => (
                <div key={family}>
                  <p className="mb-2 text-[12px] font-medium tracking-wide text-ink-muted uppercase">{family}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={serviceId === s.id}
                        onClick={() => {
                          setServiceId(serviceId === s.id ? null : s.id);
                          setSubcategoryId(null);
                        }}
                        className={cn(
                          'rounded-card border px-3 py-2.5 text-left transition-colors',
                          serviceId === s.id ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface-hover',
                        )}
                      >
                        <span className="block text-[13px] font-medium text-ink">{s.name}</span>
                        {s.description ? <span className="mt-0.5 block text-[12px] text-ink-muted line-clamp-2">{s.description}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {service && service.subcategories.length > 0 ? (
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink">More precisely</p>
                  <div className="flex flex-wrap gap-2">
                    {service.subcategories.map((sc) => (
                      <button
                        key={sc.id}
                        type="button"
                        aria-pressed={subcategoryId === sc.id}
                        onClick={() => setSubcategoryId(subcategoryId === sc.id ? null : sc.id)}
                        className={cn(
                          'rounded-control border px-3 py-1.5 text-[13px]',
                          subcategoryId === sc.id ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-ink hover:bg-surface-hover',
                        )}
                      >
                        {sc.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title="2. Describe it" />
        <CardBody className="space-y-4">
          <div>
            <label htmlFor="title" className="mb-1.5 block text-[13px] font-medium text-ink">Title</label>
            <Input id="title" placeholder="A short summary" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="description" className="mb-1.5 block text-[13px] font-medium text-ink">Description</label>
            <textarea id="description" rows={6} className={CONTROL} placeholder="What happened, what you expected, and anything you have tried." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label htmlFor="urgency" className="mb-1.5 block text-[13px] font-medium text-ink">How urgent is it?</label>
            <select id="urgency" className={cn(CONTROL, 'appearance-none sm:w-80')} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {URGENCY.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={!title.trim() || !description.trim()} loading={create.isPending}>
          Submit request
        </Button>
      </div>
    </>
  );
}
