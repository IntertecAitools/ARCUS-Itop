'use client';

import type { ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { Card } from '@/components/data-display';
import { FormField, RichText, SelectedChips, describedBy, fieldLabelId } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { CiSelect } from '@/features/cmdb';
import { OrgSelect, PersonSelect } from '@/features/contacts';
import { IncidentPicker } from '@/features/incidents';
import { ServiceSelect, SubcategorySelect } from '@/features/service-catalog';
import type { LookupOption } from '@/types';
import {
  PROBLEM_IMPACTS,
  PROBLEM_URGENCIES,
  emptyProblemCreateValues,
  problemCreateSchema,
  type ProblemCreateValues,
} from '../schemas';
import type { ProblemCreateInput, ProblemImpact, ProblemUrgency } from '../types';
import { PriorityPreview } from './ProblemBadges';

type Output = z.output<typeof problemCreateSchema>;

export function toCreateInput(values: Output): ProblemCreateInput {
  return {
    org_id: values.org?.id ?? '',
    caller_id: values.caller?.id ?? null,
    title: values.title.trim(),
    description: values.description,
    service_id: values.service?.id ?? null,
    servicesubcategory_id: values.subcategory?.id ?? null,
    product: values.product.trim(),
    impact: values.impact as ProblemImpact,
    urgency: values.urgency as ProblemUrgency,
    functionalcis_list: values.cis.map((c) => ({ functionalci_id: c.id })),
    contacts_list: values.contacts.map((c) => ({ contact_id: c.id })),
    related_incident_ids: values.incidents.map((i) => i.id),
  };
}

export interface ProblemFormProps {
  onSubmit: (input: ProblemCreateInput) => Promise<unknown>;
  onCancel: () => void;
  defaultValues?: Partial<ProblemCreateValues>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </Card>
  );
}

export function ProblemForm({ onSubmit, onCancel, defaultValues }: ProblemFormProps) {
  const { t } = useTranslation('problems');
  const { t: tc } = useTranslation();
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProblemCreateValues, unknown, Output>({
    resolver: zodResolver(problemCreateSchema),
    defaultValues: { ...emptyProblemCreateValues, ...defaultValues },
  });

  const org = useWatch({ control, name: 'org' });
  const service = useWatch({ control, name: 'service' });
  const impact = useWatch({ control, name: 'impact' });
  const urgency = useWatch({ control, name: 'urgency' });
  const cis = useWatch({ control, name: 'cis' });
  const contacts = useWatch({ control, name: 'contacts' });
  const incidents = useWatch({ control, name: 'incidents' });

  const err = (message?: string) => (message ? tc(message) : undefined);
  const e = {
    org: err(errors.org?.message),
    title: err(errors.title?.message),
    description: err(errors.description?.message),
    product: err(errors.product?.message),
    impact: err(errors.impact?.message),
    urgency: err(errors.urgency?.message),
  };

  function addTo(name: 'cis' | 'contacts' | 'incidents', current: LookupOption[], option: LookupOption | null) {
    if (option && !current.some((c) => c.id === option.id)) setValue(name, [...current, option], { shouldDirty: true });
  }
  function removeFrom(name: 'cis' | 'contacts' | 'incidents', current: LookupOption[], id: string) {
    setValue(
      name,
      current.filter((c) => c.id !== id),
      { shouldDirty: true },
    );
  }
  const removeLabel = (label: string) => tc('actions.removeItem', { label });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(toCreateInput(values));
    } catch {
      // reported by the global toast
    }
  });

  return (
    <form noValidate onSubmit={submit} className="space-y-6" aria-label={t('new.title')}>
      <Section title={t('new.sections.general')}>
        <FormField htmlFor="p-org" label={t('fields.org_id')} required error={e.org}>
          <Controller
            control={control}
            name="org"
            render={({ field }) => (
              <OrgSelect
                id="p-org"
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  // the caller belongs to the organization
                  setValue('caller', null);
                }}
                onBlur={field.onBlur}
                invalid={!!e.org}
                describedBy={describedBy('p-org', { error: e.org })}
              />
            )}
          />
        </FormField>
        <FormField htmlFor="p-caller" label={t('fields.caller_id')} hint={org ? undefined : t('new.callerHint')}>
          <Controller
            control={control}
            name="caller"
            render={({ field }) => (
              <PersonSelect
                id="p-caller"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                scope={{ orgId: org?.id }}
                disabled={!org}
                describedBy={org ? undefined : describedBy('p-caller', { hint: t('new.callerHint') })}
              />
            )}
          />
        </FormField>
        <FormField htmlFor="p-title" label={t('fields.title')} required error={e.title} className="md:col-span-2">
          <Input
            id="p-title"
            invalid={!!e.title}
            aria-describedby={describedBy('p-title', { error: e.title })}
            {...register('title')}
          />
        </FormField>
        <FormField
          htmlFor="p-description"
          label={t('fields.description')}
          required
          error={e.description}
          labelAs="span"
          className="md:col-span-2"
        >
          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <RichText
                id="p-description"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                labelledBy={fieldLabelId('p-description')}
                describedBy={describedBy('p-description', { error: e.description })}
                invalid={!!e.description}
                placeholder={t('new.descriptionPlaceholder')}
              />
            )}
          />
        </FormField>
      </Section>

      <Section title={t('new.sections.qualification')}>
        <FormField htmlFor="p-service" label={t('fields.service_id')}>
          <Controller
            control={control}
            name="service"
            render={({ field }) => (
              <ServiceSelect
                id="p-service"
                orgId={org?.id}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  // subcategories depend on the service
                  setValue('subcategory', null);
                }}
                onBlur={field.onBlur}
              />
            )}
          />
        </FormField>
        <FormField htmlFor="p-subcategory" label={t('fields.servicesubcategory_id')}>
          <Controller
            control={control}
            name="subcategory"
            render={({ field }) => (
              <SubcategorySelect
                id="p-subcategory"
                serviceId={service?.id}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
        </FormField>
        <FormField htmlFor="p-product" label={t('fields.product')} error={e.product}>
          <Input id="p-product" invalid={!!e.product} {...register('product')} />
        </FormField>
        <div className="hidden md:block" />
        <FormField htmlFor="p-impact" label={t('fields.impact')} required error={e.impact}>
          <Select
            id="p-impact"
            placeholder={tc('actions.select')}
            invalid={!!e.impact}
            aria-describedby={describedBy('p-impact', { error: e.impact })}
            options={PROBLEM_IMPACTS.map((v) => ({ value: v, label: t(`impact.${v}`) }))}
            {...register('impact')}
          />
        </FormField>
        <FormField htmlFor="p-urgency" label={t('fields.urgency')} required error={e.urgency}>
          <Select
            id="p-urgency"
            placeholder={tc('actions.select')}
            invalid={!!e.urgency}
            aria-describedby={describedBy('p-urgency', { error: e.urgency })}
            options={PROBLEM_URGENCIES.map((v) => ({ value: v, label: t(`urgency.${v}`) }))}
            {...register('urgency')}
          />
        </FormField>
        <FormField htmlFor="p-priority" label={t('fields.priority')} labelAs="span" className="md:col-span-2">
          <PriorityPreview impact={impact} urgency={urgency} />
        </FormField>
      </Section>

      <Section title={t('new.sections.relations')}>
        <FormField htmlFor="p-cis" label={t('fields.functionalcis_list')}>
          <CiSelect
            id="p-cis"
            value={null}
            excludeIds={cis.map((c) => c.id)}
            placeholder={t('new.addCi')}
            onChange={(v) => addTo('cis', cis, v)}
          />
          <SelectedChips items={cis} onRemove={(id) => removeFrom('cis', cis, id)} removeLabel={removeLabel} />
        </FormField>
        <FormField htmlFor="p-contacts" label={t('fields.contacts_list')}>
          <PersonSelect
            id="p-contacts"
            value={null}
            excludeIds={contacts.map((c) => c.id)}
            placeholder={t('new.addContact')}
            onChange={(v) => addTo('contacts', contacts, v)}
          />
          <SelectedChips items={contacts} onRemove={(id) => removeFrom('contacts', contacts, id)} removeLabel={removeLabel} />
        </FormField>
        <FormField htmlFor="p-incidents" label={t('new.linkIncidents')} hint={t('new.linkIncidentsHint')} className="md:col-span-2">
          <IncidentPicker
            id="p-incidents"
            value={null}
            excludeIds={incidents.map((i) => i.id)}
            placeholder={t('new.addIncident')}
            describedBy={describedBy('p-incidents', { hint: t('new.linkIncidentsHint') })}
            onChange={(v) => addTo('incidents', incidents, v)}
          />
          <SelectedChips items={incidents} onRemove={(id) => removeFrom('incidents', incidents, id)} removeLabel={removeLabel} />
        </FormField>
      </Section>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {t('new.submit')}
        </Button>
      </div>
    </form>
  );
}
