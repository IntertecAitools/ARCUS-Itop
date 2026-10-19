import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, buttonClasses, Card } from '@/components/ui';
import { useCreateIncident, useIncidentOptions } from '../api/useIncidents';
import { CONTROL, Field, SectionLabel, Select } from '../components/FormField';
import { newIncidentSchema, type NewIncidentForm } from '../schemas';

/**
 * iTop's priority matrix, mirrored so the derived value can be shown BEFORE
 * the record is saved. The server remains the authority — this is a preview,
 * and the field is never submitted.
 */
const PRIORITY_MATRIX: Record<string, Record<string, string>> = {
  // urgency -> impact -> priority
  '1': { '1': 'Critical', '2': 'Critical', '3': 'High' },
  '2': { '1': 'Critical', '2': 'High', '3': 'Medium' },
  '3': { '1': 'High', '2': 'Medium', '3': 'Low' },
  '4': { '1': 'Medium', '2': 'Low', '3': 'Low' },
};

export function NewIncidentPage() {
  const navigate = useNavigate();
  const { data: options, isLoading: optionsLoading } = useIncidentOptions();
  const create = useCreateIncident();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<NewIncidentForm>({
    resolver: zodResolver(newIncidentSchema),
    defaultValues: { origin: 'portal' },
  });

  const serviceId = watch('serviceId');
  const urgency = watch('urgency');
  const impact = watch('impact');

  // A subcategory only means something under its own service, so changing the
  // service clears it rather than submitting a pair that cannot go together.
  useEffect(() => setValue('serviceSubcategoryId', ''), [serviceId, setValue]);

  const subcategories = useMemo(
    () => (options?.serviceSubcategories ?? []).filter((s) => s.serviceId === serviceId),
    [options, serviceId],
  );

  const derivedPriority =
    urgency && impact ? (PRIORITY_MATRIX[urgency]?.[impact] ?? 'Medium') : '';

  const onSubmit = handleSubmit((values) => {
    // Strip empty optional selects — the API rejects "" where it expects an id.
    const payload = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== '' && v !== undefined),
    ) as NewIncidentForm;

    create.mutate(payload, { onSuccess: (incident) => navigate(`/incidents/${incident.id}`) });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-brand-ink uppercase">
            New incident
          </p>
          <h1 className="mt-1 text-[22px] leading-7 font-semibold tracking-tight text-ink">
            Create a new incident
          </h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Provide details so your team can triage and resolve the issue.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/incidents" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
          <Button type="submit" size="sm" loading={create.isPending} disabled={optionsLoading}>
            Submit incident
          </Button>
        </div>
      </div>

      {create.isError ? (
        <p
          role="alert"
          className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
        >
          {create.error instanceof Error ? create.error.message : 'Could not raise the incident.'}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        {/* ----------------------------------------------------------- main */}
        <Card className="p-5 xl:col-span-2">
          <SectionLabel>Incident details</SectionLabel>
          <div className="space-y-4">
            <Field label="Subject" htmlFor="title" required error={errors.title?.message}>
              <input
                id="title"
                className={CONTROL}
                placeholder="Short summary of the incident"
                {...register('title')}
              />
            </Field>

            <Field
              label="Description"
              htmlFor="description"
              required
              error={errors.description?.message}
              hint="No length limit. A short summary is taken from the first part for list views."
            >
              <textarea
                id="description"
                rows={8}
                className={CONTROL}
                placeholder="Describe what happened, impact, and any steps taken so far. Paste error text or logs here — there is no length limit."
                {...register('description')}
              />
            </Field>

            <Field label="Source" htmlFor="origin">
              <Select id="origin" options={options?.origins ?? []} {...register('origin')} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Urgency" htmlFor="urgency" required error={errors.urgency?.message}>
                <Select
                  id="urgency"
                  placeholder="Select urgency"
                  options={options?.urgencies ?? []}
                  {...register('urgency')}
                />
              </Field>

              <Field label="Impact" htmlFor="impact" required error={errors.impact?.message}>
                <Select
                  id="impact"
                  placeholder="Select impact"
                  options={options?.impacts ?? []}
                  {...register('impact')}
                />
              </Field>

              {/* Read-only on purpose: iTop computes priority from urgency x
                  impact and discards anything sent directly, so an editable
                  control here would be a field that silently does nothing. */}
              <Field
                label="Priority"
                htmlFor="priority"
                hint="Derived from urgency and impact using this unit's priority matrix."
              >
                <input
                  id="priority"
                  disabled
                  readOnly
                  className={CONTROL}
                  value={derivedPriority}
                  placeholder="Set urgency and impact first"
                />
              </Field>

              <Field
                label="Reported date"
                htmlFor="startDate"
                hint="Leave blank for now. Set it when logging a fault that started earlier."
              >
                <input
                  id="startDate"
                  type="datetime-local"
                  className={CONTROL}
                  {...register('startDate')}
                />
              </Field>

              <Field
                label="Service"
                htmlFor="serviceId"
                hint={
                  options?.services.length
                    ? undefined
                    : "An administrator adds these under the unit's business services."
                }
              >
                <Select
                  id="serviceId"
                  placeholder={options?.services.length ? 'Not selected' : 'No services configured'}
                  options={options?.services ?? []}
                  disabled={!options?.services.length}
                  {...register('serviceId')}
                />
              </Field>

              <Field label="Category" htmlFor="serviceSubcategoryId">
                <Select
                  id="serviceSubcategoryId"
                  placeholder={
                    !serviceId
                      ? 'Select a service first'
                      : subcategories.length
                        ? 'Not selected'
                        : 'No categories for this service'
                  }
                  options={subcategories}
                  disabled={!serviceId || !subcategories.length}
                  {...register('serviceSubcategoryId')}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* -------------------------------------------------------- sidebar */}
        <Card className="p-5">
          <SectionLabel>Details</SectionLabel>
          <div className="space-y-4">
            <Field label="Assignment group (optional)" htmlFor="teamId">
              <Select
                id="teamId"
                placeholder={options?.teams.length ? 'Auto-assign by rules' : 'No teams configured'}
                options={options?.teams ?? []}
                disabled={!options?.teams.length}
                {...register('teamId')}
              />
            </Field>

            <Field label="Assignee (optional)" htmlFor="agentId">
              <Select
                id="agentId"
                placeholder="Not assigned"
                options={options?.agents ?? []}
                {...register('agentId')}
              />
            </Field>
          </div>
        </Card>
      </div>
    </form>
  );
}
