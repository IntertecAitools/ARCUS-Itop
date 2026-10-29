import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { useKnowledgeSettings, useSaveKnowledgeSettings } from '../api/useKnowledge';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

/**
 * Who reviews knowledge articles (holders of these profiles, and
 * administrators), and how long a published article stays before it is due
 * for review again. Administrators only.
 */
export function KnowledgeSettingsPage() {
  const { data, isLoading, isError, error } = useKnowledgeSettings();
  const save = useSaveKnowledgeSettings();
  const [profiles, setProfiles] = useState('');
  const [days, setDays] = useState(180);

  useEffect(() => {
    if (!data) return;
    setProfiles(data.reviewerProfiles.join('\n'));
    setDays(data.reviewIntervalDays);
  }, [data]);

  const list = profiles.split('\n').map((p) => p.trim()).filter(Boolean);
  const dirty = Boolean(data && (list.join('\n') !== data.reviewerProfiles.join('\n') || days !== data.reviewIntervalDays));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Knowledge reviewers' }]}
        title="Knowledge reviewers"
        description="Who approves knowledge articles, and how often published ones are reviewed again."
      />
      {isError ? (
        <div role="alert" className={`${ALERT} mb-6 border-critical/30 bg-critical-soft text-critical-ink`}>
          Couldn’t load the settings. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}
      <Card className="max-w-2xl">
        <CardHeader
          title="Review"
          subtitle={
            data?.updatedAt
              ? `Last changed by ${data.updatedBy || 'an administrator'}, ${dateTimeText(data.updatedAt)}.`
              : 'The platform’s defaults apply.'
          }
        />
        <CardBody>
          {isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate({ reviewerProfiles: list, reviewIntervalDays: days });
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="kb-profiles" className="block text-[13px] font-medium text-ink">
                  Reviewer profiles
                </label>
                <textarea
                  id="kb-profiles"
                  rows={4}
                  className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-ring/40"
                  value={profiles}
                  onChange={(e) => setProfiles(e.target.value)}
                />
                <p className="text-[12px] text-ink-muted">
                  One profile per line, as on the Users screen (for example Document author). Administrators always
                  review. Nobody approves an article they submitted themselves.
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="kb-days" className="block text-[13px] font-medium text-ink">
                  Review again after (days)
                </label>
                <Input id="kb-days" type="number" min={7} max={1095} className="w-32" value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </div>
              {save.isError ? (
                <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
                  {save.error instanceof Error ? save.error.message : 'The settings could not be saved.'}
                </div>
              ) : null}
              {save.isSuccess && !dirty ? (
                <div role="status" className={`${ALERT} border-good/30 bg-good-soft text-good-ink`}>
                  Saved.
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={!dirty || days < 7 || days > 1095} loading={save.isPending}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </>
  );
}
