'use client';

import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { Trash2 } from 'lucide-react';
import { FormField, ReadOnlyValue, describedBy } from '@/components/forms';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { CiSelect } from '@/features/cmdb';
import { OrgSelect } from '@/features/contacts';
import {
  emptyKnownErrorForm,
  formToKnownErrorInput,
  knownErrorDomains,
  knownErrorFormSchema,
  type KnownErrorFormValues,
} from '../schemas';
import type { KnownErrorInput } from '../types';
import { ProblemRefSelect } from './ProblemRefSelect';

export interface KnownErrorFormProps {
  defaultValues?: Partial<KnownErrorFormValues>;
  /** Problem is fixed (form opened from a problem) */
  lockProblem?: boolean;
  submitLabel: string;
  onSubmit: (input: KnownErrorInput) => Promise<unknown>;
  onCancel?: () => void;
  idPrefix?: string;
}

type Output = z.output<typeof knownErrorFormSchema>;

export function KnownErrorForm({
  defaultValues,
  lockProblem = false,
  submitLabel,
  onSubmit,
  onCancel,
  idPrefix = 'ke',
}: KnownErrorFormProps) {
  const { t } = useTranslation('knowledgeBase');
  const { t: tc } = useTranslation();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KnownErrorFormValues, unknown, Output>({
    resolver: zodResolver(knownErrorFormSchema),
    defaultValues: { ...emptyKnownErrorForm, ...defaultValues },
  });
  const cis = useFieldArray({ control, name: 'cis' });
  const problem = useWatch({ control, name: 'problem' });

  const id = (name: string) => `${idPrefix}-${name}`;
  const errorOf = (message?: string) => (message ? tc(message) : undefined);
  const nameError = errorOf(errors.name?.message);
  const orgError = errorOf(errors.org?.message);
  const symptomError = errorOf(errors.symptom?.message);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(formToKnownErrorInput(values));
    } catch {
      // reported by the global toast
    }
  });

  return (
    <form noValidate onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField htmlFor={id('name')} label={t('fields.name')} required error={nameError} className="md:col-span-2">
          <Input
            id={id('name')}
            invalid={!!nameError}
            aria-describedby={describedBy(id('name'), { error: nameError })}
            {...register('name')}
          />
        </FormField>

        <FormField htmlFor={id('org')} label={t('fields.org')} required error={orgError}>
          <Controller
            control={control}
            name="org"
            render={({ field }) => (
              <OrgSelect
                id={id('org')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={!!orgError}
                describedBy={describedBy(id('org'), { error: orgError })}
              />
            )}
          />
        </FormField>

        <FormField htmlFor={id('problem')} label={t('fields.problem')}>
          {lockProblem ? (
            <ReadOnlyValue>{problem?.label}</ReadOnlyValue>
          ) : (
            <Controller
              control={control}
              name="problem"
              render={({ field }) => (
                <ProblemRefSelect id={id('problem')} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
              )}
            />
          )}
        </FormField>

        <FormField htmlFor={id('domain')} label={t('fields.domain')} required>
          <Select
            id={id('domain')}
            options={knownErrorDomains.map((d) => ({ value: d, label: t(`domain.${d}`) }))}
            {...register('domain')}
          />
        </FormField>

        <FormField htmlFor={id('error_code')} label={t('fields.errorCode')}>
          <Input id={id('error_code')} {...register('error_code')} />
        </FormField>

        <FormField htmlFor={id('vendor')} label={t('fields.vendor')}>
          <Input id={id('vendor')} {...register('vendor')} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField htmlFor={id('model')} label={t('fields.model')}>
            <Input id={id('model')} {...register('model')} />
          </FormField>
          <FormField htmlFor={id('version')} label={t('fields.version')}>
            <Input id={id('version')} {...register('version')} />
          </FormField>
        </div>
      </div>

      <FormField htmlFor={id('symptom')} label={t('fields.symptom')} required error={symptomError}>
        <Textarea
          id={id('symptom')}
          rows={3}
          invalid={!!symptomError}
          aria-describedby={describedBy(id('symptom'), { error: symptomError })}
          {...register('symptom')}
        />
      </FormField>
      <FormField htmlFor={id('root_cause')} label={t('fields.rootCause')}>
        <Textarea id={id('root_cause')} rows={3} {...register('root_cause')} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField htmlFor={id('workaround')} label={t('fields.workaround')}>
          <Textarea id={id('workaround')} rows={3} {...register('workaround')} />
        </FormField>
        <FormField htmlFor={id('solution')} label={t('fields.solution')}>
          <Textarea id={id('solution')} rows={3} {...register('solution')} />
        </FormField>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-text">{t('fields.cis')}</legend>
        <CiSelect
          id={id('ci-add')}
          value={null}
          placeholder={t('addCi')}
          excludeIds={cis.fields.map((f) => f.ci.id)}
          onChange={(option) => option && cis.append({ ci: option, reason: '' })}
        />
        {cis.fields.length > 0 && (
          <ul className="space-y-2">
            {cis.fields.map((field, index) => (
              <li key={field.id} className="flex items-center gap-3 rounded-control border border-border p-2">
                <span className="w-48 shrink-0 truncate text-sm font-medium text-text">{field.ci.label}</span>
                <label htmlFor={id(`ci-reason-${index}`)} className="sr-only">
                  {t('ciReasonFor', { name: field.ci.label })}
                </label>
                <Input
                  id={id(`ci-reason-${index}`)}
                  placeholder={t('fields.reason')}
                  {...register(`cis.${index}.reason`)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('removeCi', { name: field.ci.label })}
                  onClick={() => cis.remove(index)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            {tc('actions.cancel')}
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
