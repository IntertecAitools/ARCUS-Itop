import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useCreateIncident, useIncidentOptions } from '../api/useIncidents';
import { newIncidentSchema, type NewIncidentForm } from '../schemas';

/** A labelled field with its validation message in a fixed slot. */
function Row({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-critical">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-critical-ink">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function NewIncidentPage() {
  const navigate = useNavigate();
  const { data: options, isLoading: optionsLoading } = useIncidentOptions();
  const create = useCreateIncident();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<NewIncidentForm>({
    resolver: zodResolver(newIncidentSchema),
    defaultValues: { urgency: '3', impact: '2' },
  });

  // Only one organisation exists in most instances; preselecting it saves a
  // required click that has exactly one possible answer.
  useEffect(() => {
    const orgs = options?.organizations;
    if (orgs?.length === 1) setValue('organizationId', orgs[0].value);
  }, [options, setValue]);

  const onSubmit = handleSubmit((values) => {
    // Strip empty optional selects — the API rejects "" where it expects an id.
    const payload = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== '' && value !== undefined),
    ) as NewIncidentForm;

    create.mutate(payload, {
      onSuccess: (incident) => navigate(`/incidents/${incident.id}`),
    });
  });

  const field =
    'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Incidents', to: '/incidents' },
          { label: 'New' },
        ]}
        title="Raise an incident"
        description="Something is broken or degraded. Describe what users are seeing."
      />

      <Card className="max-w-3xl">
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <Row label="Title" htmlFor="title" required error={errors.title?.message}>
              <Input id="title" placeholder="VPN unavailable from the branch office" {...register('title')} />
            </Row>

            <Row
              label="Description"
              htmlFor="description"
              required
              error={errors.description?.message}
              hint="What is happening, who is affected, and since when."
            >
              <textarea id="description" rows={5} className={field} {...register('description')} />
            </Row>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Row
                label="Organisation"
                htmlFor="organizationId"
                required
                error={errors.organizationId?.message}
              >
                <select
                  id="organizationId"
                  className={cn(field, 'appearance-none')}
                  {...register('organizationId')}
                >
                  <option value="">Select…</option>
                  {options?.organizations.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Caller" htmlFor="callerId" hint="Who reported it.">
                <select id="callerId" className={cn(field, 'appearance-none')} {...register('callerId')}>
                  <option value="">Not specified</option>
                  {options?.agents.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>

              <Row
                label="Urgency"
                htmlFor="urgency"
                hint="Urgency and impact together set the priority."
              >
                <select id="urgency" className={cn(field, 'appearance-none')} {...register('urgency')}>
                  {options?.urgencies.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Impact" htmlFor="impact">
                <select id="impact" className={cn(field, 'appearance-none')} {...register('impact')}>
                  {options?.impacts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Origin" htmlFor="origin" hint="How it reached you.">
                <select id="origin" className={cn(field, 'appearance-none')} {...register('origin')}>
                  <option value="">Not specified</option>
                  {options?.origins.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Assign to" htmlFor="agentId" hint="Leave empty to triage later.">
                <select id="agentId" className={cn(field, 'appearance-none')} {...register('agentId')}>
                  <option value="">Unassigned</option>
                  {options?.agents.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
            </div>

            {create.isError ? (
              <p
                role="alert"
                className="rounded-control border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
              >
                {create.error instanceof Error ? create.error.message : 'Could not raise the incident.'}
              </p>
            ) : null}

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Button type="submit" loading={create.isPending} disabled={optionsLoading}>
                Raise incident
              </Button>
              <Link to="/incidents" className={buttonClasses({ variant: 'ghost' })}>
                Cancel
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
