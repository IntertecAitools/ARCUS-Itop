import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, Select, Skeleton } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { usePlanRules, useSavePlanRules } from '../api/useChanges';
import { CHANGE_TYPES, PLAN_KINDS, PLAN_LABEL, REQUIREMENT_LABEL, TYPE_LABEL } from '../lib/labels';
import type { PlanRequirement, PlanRules } from '../types';

const OPTIONS: Array<{ value: PlanRequirement; label: string }> = (['plan', 'implement', 'optional'] as const).map(
  (value) => ({ value, label: REQUIREMENT_LABEL[value] }),
);

const same = (a: PlanRules, b: PlanRules) =>
  CHANGE_TYPES.every((t) => PLAN_KINDS.every((k) => a[t][k] === b[t][k]));

/**
 * Which plans each change type must have, and from which step: Plan is
 * refused until every plan "required to plan" is written, Implement until
 * those "required to implement" are too. Administrators only.
 */
export function ChangeRulesPage() {
  const { data, isLoading, isError, error } = usePlanRules();
  const save = useSavePlanRules();
  const [draft, setDraft] = useState<PlanRules | null>(null);

  useEffect(() => {
    if (data) setDraft(structuredClone(data.rules));
  }, [data]);

  const dirty = Boolean(data && draft && !same(draft, data.rules));
  const isDefault = Boolean(data && draft && same(draft, data.defaults));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Change plan rules' }]}
        title="Change plan rules"
        description="The plans each change type needs before it can be planned or implemented."
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the rules. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Required plans"
          subtitle={
            data?.updatedAt
              ? `Last changed by ${data.updatedBy || 'an administrator'}, ${dateTimeText(data.updatedAt)}.`
              : 'The platform’s defaults apply.'
          }
        />
        <CardBody>
          {isLoading || !draft ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(draft);
              }}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-muted">
                      <th className="py-2 pe-4 font-medium">Change type</th>
                      {PLAN_KINDS.map((k) => (
                        <th key={k} className="py-2 pe-4 font-medium">
                          {PLAN_LABEL[k]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {CHANGE_TYPES.map((type) => (
                      <tr key={type} className="border-b border-line last:border-0">
                        <th scope="row" className="py-2 pe-4 text-left font-medium text-ink">
                          {TYPE_LABEL[type]}
                        </th>
                        {PLAN_KINDS.map((kind) => (
                          <td key={kind} className="py-2 pe-4">
                            <Select
                              aria-label={`${TYPE_LABEL[type]}: ${PLAN_LABEL[kind]}`}
                              className="w-52"
                              value={draft[type][kind]}
                              options={OPTIONS}
                              onChange={(e) =>
                                setDraft((d) =>
                                  d ? { ...d, [type]: { ...d[type], [kind]: e.target.value as PlanRequirement } } : d,
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[12px] text-ink-muted">
                A plan required to plan is required to implement too. Routine changes are pre-approved;
                normal and emergency changes also need the CAB’s approval before they are implemented.
              </p>

              {save.isError ? (
                <div role="alert" className="mt-3 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
                  {save.error instanceof Error ? save.error.message : 'The rules could not be saved.'}
                </div>
              ) : null}
              {save.isSuccess && !dirty ? (
                <div role="status" className="mt-3 rounded-card border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good-ink">
                  Rules saved. They apply to the next Plan or Implement on every change.
                </div>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                {!isDefault && data ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(structuredClone(data.defaults))}>
                    Use the defaults
                  </Button>
                ) : null}
                {dirty && data ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(structuredClone(data.rules))}>
                    Discard changes
                  </Button>
                ) : null}
                <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending}>
                  Save rules
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </>
  );
}
