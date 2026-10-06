'use client';

import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { FormField, describedBy } from '@/components/forms';
import { Modal } from '@/components/overlays';
import { Button, Input, Textarea } from '@/components/ui';
import { PersonSelect, TeamSelect } from '@/features/contacts';
import { ServiceSelect, SubcategorySelect } from '@/features/service-catalog';
import { toast } from '@/stores';
import { useApplyStimulus } from '../api/problems';
import { toTransitionFields, transitionSchema, type TransitionFormValues } from '../schemas';
import type { Problem, ProblemField, ProblemTransition } from '../types';

export interface TransitionDialogProps {
  problem: Problem;
  transition: ProblemTransition | null;
  onClose: () => void;
}

function initialValues(p: Problem): TransitionFormValues {
  const opt = (id: string | null, label: string | null) => (id ? { id, label: label ?? id } : null);
  return {
    team: opt(p.team_id, p.team_name),
    agent: opt(p.agent_id, p.agent_name),
    service: opt(p.service_id, p.service_name),
    subcategory: opt(p.servicesubcategory_id, p.servicesubcategory_name),
    product: p.product,
    note: '',
  };
}

function TransitionForm({ problem, transition, onClose }: TransitionDialogProps & { transition: ProblemTransition }) {
  const { t } = useTranslation('problems');
  const { t: tc } = useTranslation();
  const apply = useApplyStimulus(problem.id);
  const { stimulus } = transition;
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TransitionFormValues>({
    resolver: zodResolver(transitionSchema(stimulus)),
    defaultValues: initialValues(problem),
  });

  // Only this transition's required + prompted fields are shown.
  const shown = new Set<ProblemField>([...transition.required, ...transition.prompted]);
  const isRequired = (f: ProblemField) => transition.required.includes(f);
  const team = useWatch({ control, name: 'team' });
  const service = useWatch({ control, name: 'service' });
  const err = (message?: string) => (message ? tc(message) : undefined);
  const e = {
    team: err(errors.team?.message),
    agent: err(errors.agent?.message),
    service: err(errors.service?.message),
    product: err(errors.product?.message),
  };

  const submit = handleSubmit(async (values) => {
    try {
      await apply.mutateAsync({
        stimulus,
        input: { fields: toTransitionFields(stimulus, values), note: values.note.trim() || undefined },
      });
      toast.success(t(`transition.success.${stimulus}`, { ref: problem.ref }));
      onClose();
    } catch {
      // reported by the global toast; keep the dialog open
    }
  });

  return (
    <form noValidate onSubmit={submit} className="space-y-4" id="transition-form">
      {shown.has('team_id') && (
        <FormField htmlFor="tr-team" label={t('fields.team_id')} required={isRequired('team_id')} error={e.team}>
          <Controller
            control={control}
            name="team"
            render={({ field }) => (
              <TeamSelect
                id="tr-team"
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  // the agent must belong to the team
                  if (v?.id !== team?.id) setValue('agent', null);
                }}
                onBlur={field.onBlur}
                invalid={!!e.team}
                describedBy={describedBy('tr-team', { error: e.team })}
              />
            )}
          />
        </FormField>
      )}
      {shown.has('agent_id') && (
        <FormField htmlFor="tr-agent" label={t('fields.agent_id')} required={isRequired('agent_id')} error={e.agent}>
          <Controller
            control={control}
            name="agent"
            render={({ field }) => (
              <PersonSelect
                id="tr-agent"
                scope={{ teamId: team?.id }}
                disabled={!team}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={!!e.agent}
                describedBy={describedBy('tr-agent', { error: e.agent })}
              />
            )}
          />
        </FormField>
      )}
      {shown.has('service_id') && (
        <FormField htmlFor="tr-service" label={t('fields.service_id')} required={isRequired('service_id')} error={e.service}>
          <Controller
            control={control}
            name="service"
            render={({ field }) => (
              <ServiceSelect
                id="tr-service"
                orgId={problem.org_id}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  if (v?.id !== service?.id) setValue('subcategory', null);
                }}
                onBlur={field.onBlur}
                invalid={!!e.service}
                describedBy={describedBy('tr-service', { error: e.service })}
              />
            )}
          />
        </FormField>
      )}
      {shown.has('servicesubcategory_id') && (
        <FormField htmlFor="tr-subcategory" label={t('fields.servicesubcategory_id')} required={isRequired('servicesubcategory_id')}>
          <Controller
            control={control}
            name="subcategory"
            render={({ field }) => (
              <SubcategorySelect
                id="tr-subcategory"
                serviceId={service?.id}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
        </FormField>
      )}
      {shown.has('product') && (
        <FormField htmlFor="tr-product" label={t('fields.product')} required={isRequired('product')} error={e.product}>
          <Input id="tr-product" invalid={!!e.product} {...register('product')} />
        </FormField>
      )}
      <FormField htmlFor="tr-note" label={t('transition.note')} hint={t('transition.noteHint')}>
        <Textarea
          id="tr-note"
          rows={3}
          aria-describedby={describedBy('tr-note', { hint: t('transition.noteHint') })}
          {...register('note')}
        />
      </FormField>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" loading={apply.isPending}>
          {t(`stimulus.${stimulus}`)}
        </Button>
      </div>
    </form>
  );
}

export function TransitionDialog({ problem, transition, onClose }: TransitionDialogProps) {
  const { t } = useTranslation('problems');
  return (
    <Modal
      open={!!transition}
      onClose={onClose}
      title={transition ? t(`transition.title.${transition.stimulus}`, { ref: problem.ref }) : ''}
      description={transition ? t(`transition.description.${transition.stimulus}`) : undefined}
    >
      {transition && (
        <TransitionForm key={transition.stimulus} problem={problem} transition={transition} onClose={onClose} />
      )}
    </Modal>
  );
}
