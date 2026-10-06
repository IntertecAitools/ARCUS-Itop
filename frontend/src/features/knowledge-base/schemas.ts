import { z } from 'zod';
import { lookupOptionSchema } from '@/features/contacts';
import type { KnownError, KnownErrorDomain, KnownErrorInput } from './types';

export const knownErrorDomains = ['Network', 'Server', 'Application', 'Desktop'] as const satisfies readonly KnownErrorDomain[];

const optionalText = z.string().max(255, 'validation.tooLong');

/** iTop: name, org_id and symptom are mandatory; everything else is optional. */
export const knownErrorFormSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(255, 'validation.tooLong'),
  org: lookupOptionSchema.nullable().refine((v) => v !== null, { message: 'validation.required' }),
  problem: lookupOptionSchema.nullable(),
  symptom: z.string().trim().min(1, 'validation.required'),
  root_cause: z.string(),
  workaround: z.string(),
  solution: z.string(),
  error_code: optionalText,
  domain: z.enum(knownErrorDomains),
  vendor: optionalText,
  model: optionalText,
  version: optionalText,
  cis: z.array(z.object({ ci: lookupOptionSchema, reason: optionalText })),
});

export type KnownErrorFormValues = z.input<typeof knownErrorFormSchema>;

export const emptyKnownErrorForm: KnownErrorFormValues = {
  name: '',
  org: null,
  problem: null,
  symptom: '',
  root_cause: '',
  workaround: '',
  solution: '',
  error_code: '',
  domain: 'Application',
  vendor: '',
  model: '',
  version: '',
  cis: [],
};

export function knownErrorToForm(ke: KnownError): KnownErrorFormValues {
  return {
    name: ke.name,
    org: { id: ke.org_id, label: ke.org_name },
    problem: ke.problem_id ? { id: ke.problem_id, label: ke.problem_ref ?? ke.problem_id } : null,
    symptom: ke.symptom,
    root_cause: ke.root_cause,
    workaround: ke.workaround,
    solution: ke.solution,
    error_code: ke.error_code,
    domain: ke.domain,
    vendor: ke.vendor,
    model: ke.model,
    version: ke.version,
    cis: ke.ci_list.map((c) => ({ ci: { id: c.functionalci_id, label: c.functionalci_name }, reason: c.reason })),
  };
}

export function formToKnownErrorInput(values: KnownErrorFormValues): KnownErrorInput {
  return {
    name: values.name.trim(),
    org_id: values.org?.id ?? '',
    problem_id: values.problem?.id ?? null,
    symptom: values.symptom,
    root_cause: values.root_cause,
    workaround: values.workaround,
    solution: values.solution,
    error_code: values.error_code,
    domain: values.domain,
    vendor: values.vendor,
    model: values.model,
    version: values.version,
    ci_list: values.cis.map((c) => ({ functionalci_id: c.ci.id, reason: c.reason })),
  };
}
