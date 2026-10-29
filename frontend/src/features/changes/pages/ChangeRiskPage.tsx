import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, IconButton, Input, Skeleton, Tabs } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { useRiskModel, useSaveRiskModel } from '../api/useChanges';
import { CHANGE_TYPES, TYPE_LABEL } from '../lib/labels';
import type { ChangeType, RiskModel, RiskQuestion } from '../types';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

/** A fresh id for a question or answer an administrator adds. */
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const blankQuestion = (): RiskQuestion => ({
  id: newId('q'),
  text: '',
  help: '',
  weight: 1,
  options: [
    { id: newId('o'), label: 'Low', score: 0 },
    { id: newId('o'), label: 'High', score: 10 },
  ],
});

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Every question has text and every answer a label: what the BFF accepts. */
function problems(model: RiskModel): string[] {
  const out: string[] = [];
  for (const type of CHANGE_TYPES) {
    for (const [i, q] of model.questions[type].entries()) {
      if (!q.text.trim()) out.push(`${TYPE_LABEL[type]} question ${i + 1} has no text.`);
      if (q.options.length < 2) out.push(`${TYPE_LABEL[type]} question ${i + 1} needs at least two answers.`);
      if (q.options.some((o) => !o.label.trim())) out.push(`${TYPE_LABEL[type]} question ${i + 1} has an answer without a label.`);
    }
  }
  if (model.thresholds.medium >= model.thresholds.high) out.push('The medium threshold must be below the high one.');
  return out;
}

/**
 * The risk questionnaire for each change type: weighted questions whose
 * answers score 0 (no risk) to 10. A change's score is the weighted share of
 * the maximum, 0–100; the thresholds turn it into low, medium or high.
 * Administrators only.
 */
export function ChangeRiskPage() {
  const { data, isLoading, isError, error } = useRiskModel();
  const save = useSaveRiskModel();
  const [draft, setDraft] = useState<RiskModel | null>(null);
  const [type, setType] = useState<ChangeType>('normal');

  useEffect(() => {
    if (data) setDraft(structuredClone(data.model));
  }, [data]);

  const dirty = Boolean(data && draft && JSON.stringify(draft) !== JSON.stringify(data.model));
  const issues = draft ? problems(draft) : [];

  const setQuestions = (fn: (qs: RiskQuestion[]) => RiskQuestion[]) =>
    setDraft((d) => (d ? { ...d, questions: { ...d.questions, [type]: fn(d.questions[type]) } } : d));
  const setQuestion = (index: number, patch: Partial<RiskQuestion>) =>
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Change risk questions' }]}
        title="Change risk questions"
        description="The questions each change type answers to score its risk, and where low, medium and high begin."
      />

      {isError ? (
        <div role="alert" className={`${ALERT} mb-6 border-critical/30 bg-critical-soft text-critical-ink`}>
          Couldn’t load the questions. {errorText(error, '')}
        </div>
      ) : null}

      {isLoading || !draft || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (issues.length === 0) save.mutate(draft);
          }}
        >
          <Card>
            <CardHeader
              title="Scoring"
              subtitle={
                data.updatedAt
                  ? `Last changed by ${data.updatedBy || 'an administrator'}, ${dateTimeText(data.updatedAt)}.`
                  : 'The platform’s defaults apply.'
              }
            />
            <CardBody className="flex flex-wrap items-end gap-4">
              {(['medium', 'high'] as const).map((level) => (
                <div key={level} className="space-y-1.5">
                  <label htmlFor={`th-${level}`} className="block text-[13px] font-medium text-ink">
                    {level === 'medium' ? 'Medium risk from' : 'High risk from'}
                  </label>
                  <Input
                    id={`th-${level}`}
                    type="number"
                    min={1}
                    max={100}
                    className="w-28"
                    value={draft.thresholds[level]}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, thresholds: { ...d.thresholds, [level]: Number(e.target.value) } } : d))
                    }
                  />
                </div>
              ))}
              <p className="max-w-md text-[12px] text-ink-muted">
                Scores run from 0 to 100. A high-risk routine change cannot go ahead as pre-approved: it must be raised
                as a normal change, which goes to the CAB.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Questions" />
            <CardBody className="space-y-4">
              <Tabs
                items={CHANGE_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t], count: draft.questions[t].length }))}
                value={type}
                onChange={(t) => setType(t as ChangeType)}
              />
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={draft.requiredBeforePlan[type]}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, requiredBeforePlan: { ...d.requiredBeforePlan, [type]: e.target.checked } } : d,
                    )
                  }
                />
                Must be answered before a {TYPE_LABEL[type].toLowerCase()} change is planned
              </label>

              {draft.questions[type].map((q, qi) => (
                <fieldset key={q.id} className="space-y-3 rounded-card border border-line p-3">
                  <legend className="px-1 text-[12px] font-medium text-ink-muted">Question {qi + 1}</legend>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-64 flex-1 space-y-1.5">
                      <label htmlFor={`${q.id}-text`} className="block text-[13px] font-medium text-ink">Question</label>
                      <Input id={`${q.id}-text`} value={q.text} onChange={(e) => setQuestion(qi, { text: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`${q.id}-weight`} className="block text-[13px] font-medium text-ink">Weight</label>
                      <Input
                        id={`${q.id}-weight`}
                        type="number"
                        min={1}
                        max={10}
                        className="w-20"
                        value={q.weight}
                        onChange={(e) => setQuestion(qi, { weight: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                      />
                    </div>
                    <IconButton
                      type="button"
                      label={`Remove question ${qi + 1}`}
                      icon={<Trash2 className="size-4" />}
                      onClick={() => setQuestions((qs) => qs.filter((_, i) => i !== qi))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`${q.id}-help`} className="block text-[13px] font-medium text-ink">Help text</label>
                    <Input id={`${q.id}-help`} value={q.help} onChange={(e) => setQuestion(qi, { help: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[13px] font-medium text-ink">Answers and their risk (0–10)</p>
                    {q.options.map((o, oi) => (
                      <div key={o.id} className="flex items-center gap-2">
                        <Input
                          aria-label={`Answer ${oi + 1}`}
                          className="flex-1"
                          value={o.label}
                          onChange={(e) =>
                            setQuestion(qi, { options: q.options.map((x, i) => (i === oi ? { ...x, label: e.target.value } : x)) })
                          }
                        />
                        <Input
                          aria-label={`Risk of answer ${oi + 1}`}
                          type="number"
                          min={0}
                          max={10}
                          className="w-20"
                          value={o.score}
                          onChange={(e) =>
                            setQuestion(qi, {
                              options: q.options.map((x, i) =>
                                i === oi ? { ...x, score: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } : x,
                              ),
                            })
                          }
                        />
                        <IconButton
                          type="button"
                          label={`Remove answer ${oi + 1}`}
                          icon={<Trash2 className="size-4" />}
                          disabled={q.options.length <= 2}
                          onClick={() => setQuestion(qi, { options: q.options.filter((_, i) => i !== oi) })}
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      leadingIcon={<Plus className="size-4" />}
                      onClick={() => setQuestion(qi, { options: [...q.options, { id: newId('o'), label: '', score: 5 }] })}
                    >
                      Add answer
                    </Button>
                  </div>
                </fieldset>
              ))}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                leadingIcon={<Plus className="size-4" />}
                onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}
              >
                Add question
              </Button>
            </CardBody>
          </Card>

          {issues.length && dirty ? (
            <div role="status" className={`${ALERT} border-warning/30 bg-warning-soft text-ink`}>
              {issues.map((i) => (
                <p key={i}>{i}</p>
              ))}
            </div>
          ) : null}
          {save.isError ? (
            <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
              {errorText(save.error, 'The questions could not be saved.')}
            </div>
          ) : null}
          {save.isSuccess && !dirty ? (
            <div role="status" className={`${ALERT} border-good/30 bg-good-soft text-good-ink`}>
              Saved. Changes assessed before keep their score until they are answered again.
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(structuredClone(data.defaults))}>
              Use the defaults
            </Button>
            {dirty ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(structuredClone(data.model))}>
                Discard changes
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!dirty || issues.length > 0} loading={save.isPending}>
              Save questions
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
