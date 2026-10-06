'use client';

import type { ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Card, DescriptionList } from '@/components/data-display';
import { FormField, ReadOnlyValue, RichText, describedBy, fieldLabelId } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { OrgSelect, PersonSelect, TeamSelect } from '@/features/contacts';
import { ServiceSelect, SubcategorySelect } from '@/features/service-catalog';
import { formatDateTime, sanitizeHtml } from '@/lib/utils';
import { toast } from '@/stores';
import { useUpdateProblem } from '../../api/problems';
import {
  EDIT_FORM_FIELDS,
  PROBLEM_IMPACTS,
  PROBLEM_URGENCIES,
  fieldMode,
  problemEditSchema,
  problemToEditValues,
  visibleDates,
  type EditFormKey,
  type ProblemEditValues,
} from '../../schemas';
import type { Problem, ProblemUpdateInput } from '../../types';
import { PriorityPreview, ProblemPriorityBadge } from '../ProblemBadges';

/** Only dirty, editable fields are sent; lookups are sent as ids. */
function toUpdateInput(values: ProblemEditValues, dirty: Partial<Record<EditFormKey, unknown>>, problem: Problem) {
  const input: Record<string, unknown> = {};
  for (const key of Object.keys(dirty) as EditFormKey[]) {
    const field = EDIT_FORM_FIELDS[key];
    const mode = fieldMode(problem.status, field);
    if (mode !== 'optional' && mode !== 'mandatory') continue;
    const value = values[key];
    input[field] = value && typeof value === 'object' ? value.id : value === '' && field !== 'product' ? null : value;
  }
  return input as ProblemUpdateInput;
}

export function DetailsTab({ problem, canWrite }: { problem: Problem; canWrite: boolean }) {
  const { t } = useTranslation('problems');
  const { t: tc } = useTranslation();
  const update = useUpdateProblem(problem.id);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<ProblemEditValues>({
    resolver: zodResolver(problemEditSchema(problem.status)),
    values: problemToEditValues(problem),
    resetOptions: { keepDirtyValues: true },
  });

  const mode = (key: EditFormKey) => {
    const m = fieldMode(problem.status, EDIT_FORM_FIELDS[key]);
    // Without write rights everything visible is read-only.
    return !canWrite && m !== 'hidden' ? 'readonly' : m;
  };
  const editable = (key: EditFormKey) => ['optional', 'mandatory'].includes(mode(key));
  const required = (key: EditFormKey) => mode(key) === 'mandatory';
  const errorOf = (key: EditFormKey) => {
    const message = errors[key]?.message;
    return typeof message === 'string' ? tc(message) : undefined;
  };

  const org = useWatch({ control, name: 'org' });
  const team = useWatch({ control, name: 'team' });
  const service = useWatch({ control, name: 'service' });
  const impact = useWatch({ control, name: 'impact' });
  const urgency = useWatch({ control, name: 'urgency' });
  const anyEditable = (Object.keys(EDIT_FORM_FIELDS) as EditFormKey[]).some(editable);

  const submit = handleSubmit(async (values) => {
    const input = toUpdateInput(values, dirtyFields as Partial<Record<EditFormKey, unknown>>, problem);
    if (Object.keys(input).length === 0) return;
    try {
      await update.mutateAsync(input);
      toast.success(t('detail.saved'));
      reset(undefined, { keepValues: true });
    } catch {
      // reported by the global toast; optimistic change rolled back
    }
  });

  function Field({ k, label, control: node, readValue, wide }: { k: EditFormKey; label: string; control: ReactNode; readValue: ReactNode; wide?: boolean }) {
    if (mode(k) === 'hidden') return null;
    const id = `pd-${k}`;
    const error = errorOf(k);
    return (
      <FormField
        htmlFor={id}
        label={label}
        required={editable(k) && required(k)}
        error={error}
        className={wide ? 'md:col-span-2' : undefined}
        labelAs={!editable(k) || k === 'description' ? 'span' : 'label'}
      >
        {editable(k) ? node : <ReadOnlyValue>{readValue}</ReadOnlyValue>}
      </FormField>
    );
  }

  const lookupProps = (k: EditFormKey) => ({
    id: `pd-${k}`,
    invalid: !!errorOf(k),
    describedBy: describedBy(`pd-${k}`, { error: errorOf(k) }),
  });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <form noValidate onSubmit={submit} className="xl:col-span-2" aria-label={t('detail.tabs.details')}>
        <Card title={t('detail.sections.general')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Field({
              k: 'org',
              label: t('fields.org_id'),
              readValue: problem.org_name,
              control: (
                <Controller
                  control={control}
                  name="org"
                  render={({ field }) => (
                    <OrgSelect
                      {...lookupProps('org')}
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        setValue('caller', null, { shouldDirty: true });
                      }}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              ),
            })}
            {Field({
              k: 'caller',
              label: t('fields.caller_id'),
              readValue: problem.caller_name,
              control: (
                <Controller
                  control={control}
                  name="caller"
                  render={({ field }) => (
                    <PersonSelect
                      {...lookupProps('caller')}
                      scope={{ orgId: org?.id }}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              ),
            })}
            {Field({
              k: 'title',
              label: t('fields.title'),
              wide: true,
              readValue: problem.title,
              control: (
                <Input
                  id="pd-title"
                  invalid={!!errorOf('title')}
                  aria-describedby={describedBy('pd-title', { error: errorOf('title') })}
                  {...register('title')}
                />
              ),
            })}
            {Field({
              k: 'description',
              label: t('fields.description'),
              wide: true,
              readValue: <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(problem.description) }} />,
              control: (
                <Controller
                  control={control}
                  name="description"
                  render={({ field }) => (
                    <RichText
                      id="pd-description"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      labelledBy={fieldLabelId('pd-description')}
                      describedBy={describedBy('pd-description', { error: errorOf('description') })}
                      invalid={!!errorOf('description')}
                    />
                  )}
                />
              ),
            })}
          </div>
        </Card>

        <Card title={t('detail.sections.qualification')} className="mt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Field({
              k: 'service',
              label: t('fields.service_id'),
              readValue: problem.service_name,
              control: (
                <Controller
                  control={control}
                  name="service"
                  render={({ field }) => (
                    <ServiceSelect
                      {...lookupProps('service')}
                      orgId={org?.id}
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        setValue('subcategory', null, { shouldDirty: true });
                      }}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              ),
            })}
            {Field({
              k: 'subcategory',
              label: t('fields.servicesubcategory_id'),
              readValue: problem.servicesubcategory_name,
              control: (
                <Controller
                  control={control}
                  name="subcategory"
                  render={({ field }) => (
                    <SubcategorySelect
                      {...lookupProps('subcategory')}
                      serviceId={service?.id}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              ),
            })}
            {Field({
              k: 'product',
              label: t('fields.product'),
              readValue: problem.product,
              control: <Input id="pd-product" invalid={!!errorOf('product')} {...register('product')} />,
            })}
            <div className="hidden md:block" />
            {Field({
              k: 'impact',
              label: t('fields.impact'),
              readValue: t(`impact.${problem.impact}`),
              control: (
                <Select
                  id="pd-impact"
                  invalid={!!errorOf('impact')}
                  options={PROBLEM_IMPACTS.map((v) => ({ value: v, label: t(`impact.${v}`) }))}
                  {...register('impact')}
                />
              ),
            })}
            {Field({
              k: 'urgency',
              label: t('fields.urgency'),
              readValue: t(`urgency.${problem.urgency}`),
              control: (
                <Select
                  id="pd-urgency"
                  invalid={!!errorOf('urgency')}
                  options={PROBLEM_URGENCIES.map((v) => ({ value: v, label: t(`urgency.${v}`) }))}
                  {...register('urgency')}
                />
              ),
            })}
            <FormField htmlFor="pd-priority" label={t('fields.priority')} labelAs="span" className="md:col-span-2">
              {editable('impact') && (dirtyFields.impact || dirtyFields.urgency) ? (
                <PriorityPreview impact={impact} urgency={urgency} />
              ) : (
                <ReadOnlyValue>
                  <ProblemPriorityBadge priority={problem.priority} />
                </ReadOnlyValue>
              )}
            </FormField>
          </div>
        </Card>

        {(mode('team') !== 'hidden' || mode('agent') !== 'hidden') && (
          <Card title={t('detail.sections.assignment')} className="mt-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Field({
                k: 'team',
                label: t('fields.team_id'),
                readValue: problem.team_name,
                control: (
                  <Controller
                    control={control}
                    name="team"
                    render={({ field }) => (
                      <TeamSelect
                        {...lookupProps('team')}
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v);
                          setValue('agent', null, { shouldDirty: true });
                        }}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                ),
              })}
              {Field({
                k: 'agent',
                label: t('fields.agent_id'),
                readValue: problem.agent_name,
                control: (
                  <Controller
                    control={control}
                    name="agent"
                    render={({ field }) => (
                      <PersonSelect
                        {...lookupProps('agent')}
                        scope={{ teamId: team?.id }}
                        disabled={!team}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                ),
              })}
            </div>
          </Card>
        )}

        {anyEditable && (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={!isDirty || update.isPending} onClick={() => reset(problemToEditValues(problem))}>
              {tc('actions.discard')}
            </Button>
            <Button type="submit" disabled={!isDirty} loading={update.isPending}>
              {tc('actions.save')}
            </Button>
          </div>
        )}
      </form>

      <Card title={t('detail.sections.dates')} className="self-start">
        <DescriptionList
          className="sm:grid-cols-1"
          items={visibleDates(problem.status).map((d) => ({
            label: t(`fields.${d}`),
            value: formatDateTime(problem[d]) || '—',
          }))}
        />
      </Card>
    </div>
  );
}
