import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, Skeleton, type BadgeTone } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { useChangeRisk, useSaveRisk } from '../api/useChanges';
import type { RiskLevel } from '../types';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

export const RISK_TONE: Record<RiskLevel, BadgeTone> = { low: 'good', medium: 'warning', high: 'critical' };
export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * The change's risk questionnaire: weighted questions for its type (edited
 * under Change risk questions), answered here. The score and level are kept
 * with the change; a high-risk routine change cannot go ahead pre-approved.
 */
export function RiskCard({ id }: { id: string }) {
  const risk = useChangeRisk(id);
  const save = useSaveRisk(id);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (risk.data) setAnswers({ ...risk.data.answers });
  }, [risk.data]);

  if (risk.isLoading) return <Skeleton className="h-64 w-full" />;
  if (risk.isError || !risk.data) {
    return (
      <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
        {errorText(risk.error, 'The risk questionnaire could not be loaded.')}
      </div>
    );
  }

  const data = risk.data;
  const complete = data.questions.every((q) => q.options.some((o) => o.id === answers[q.id]));
  const dirty = data.questions.some((q) => answers[q.id] !== data.answers[q.id]);

  return (
    <Card>
      <CardHeader
        title="Risk assessment"
        subtitle={
          data.assessedAt
            ? `Assessed by ${data.assessedBy || 'someone'} on ${dateTimeText(data.assessedAt)}`
            : data.required
              ? 'Required before the change is planned'
              : 'Not assessed yet'
        }
        action={
          data.level ? (
            <Badge tone={RISK_TONE[data.level]} dot>
              {RISK_LABEL[data.level]} · {data.score}
            </Badge>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {data.forcesCab ? (
          <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
            High risk: this routine change cannot go ahead as pre-approved. Raise it as a normal change so the CAB
            reviews it.
          </div>
        ) : data.level === 'high' ? (
          <div role="status" className={`${ALERT} border-warning/30 bg-warning-soft text-ink`}>
            High risk: the CAB weighs it before approving.
          </div>
        ) : null}
        {data.stale ? (
          <div role="status" className={`${ALERT} border-warning/30 bg-warning-soft text-ink`}>
            The questions changed since this was assessed: answer the new ones.
          </div>
        ) : null}

        {data.questions.length === 0 ? (
          <p className="text-[13px] text-ink-muted">There are no risk questions for this change type.</p>
        ) : (
          <form
            className="space-y-4"
            aria-label="Risk questionnaire"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(answers);
            }}
          >
            {data.questions.map((q) => (
              <fieldset key={q.id} className="space-y-1.5" disabled={!data.canEdit}>
                <legend className="text-[13px] font-medium text-ink">{q.text}</legend>
                {q.help ? <p className="text-[12px] text-ink-muted">{q.help}</p> : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {q.options.map((o) => (
                    <label key={o.id} className="flex items-center gap-1.5 text-[13px] text-ink">
                      <input
                        type="radio"
                        name={`risk-${q.id}`}
                        value={o.id}
                        checked={answers[q.id] === o.id}
                        onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

            {save.isError ? (
              <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
                {errorText(save.error, 'The answers could not be saved.')}
              </div>
            ) : null}

            {data.canEdit ? (
              <div className="flex items-center justify-end gap-2">
                {!complete ? <span className="text-[12px] text-ink-muted">Answer every question to score it.</span> : null}
                <Button type="submit" size="sm" disabled={!complete || !dirty} loading={save.isPending}>
                  Save assessment
                </Button>
              </div>
            ) : (
              <p className="text-[12px] text-ink-muted">The change is past the point where its risk is assessed.</p>
            )}
          </form>
        )}
      </CardBody>
    </Card>
  );
}
