import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, ThumbsDown, ThumbsUp } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, buttonClasses, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { useArticle, useArticleAction, useRateArticle } from '../api/useKnowledge';
import { ArticleFeedback } from '../components/ArticleFeedback';
import { ACTION_LABEL, htmlToText, KIND_LABEL, STATE_LABEL, STATE_TONE } from '../lib/labels';
import type { ArticleAction, ArticleDetail, ArticleKind } from '../types';

const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';
const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

const EVENT_LABEL: Record<ArticleDetail['history'][number]['action'], string> = {
  created: 'Created',
  submit: 'Submitted for review',
  approve: 'Approved and published',
  send_back: 'Sent back',
  reviewed: 'Reviewed',
  retire: 'Retired',
  restore: 'Restored to draft',
};

/** Actions that set the next review date. */
const DATED: ArticleAction[] = ['approve', 'reviewed'];

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * One article: its text, its state and what can be done with it next
 * (submit, approve or send back with comments, mark reviewed, retire), its
 * history, and what readers said about it. The text itself is edited on the
 * record screen.
 */
export function KnowledgeArticlePage() {
  const { kind = 'faq', id = '' } = useParams();
  const article = useArticle(kind as ArticleKind, id);

  if (article.isLoading) return <Skeleton className="h-96 w-full" />;
  if (article.isError || !article.data) {
    return (
      <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
        {errorText(article.error, 'The article could not be loaded.')}
      </div>
    );
  }
  const data = article.data;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Knowledge', to: '/knowledge' }, { label: data.title || 'Article' }]}
        title={data.title || '(untitled)'}
        description={[KIND_LABEL[data.kind], data.category, data.author ? `by ${data.author}` : ''].filter(Boolean).join(' · ')}
        actions={
          <Link to={`/records/${data.recordClass}/${data.id}`} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
            <Pencil className="size-4" aria-hidden /> Edit text
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-5">
              {data.sections.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No text yet: write it on the record screen.</p>
              ) : (
                data.sections.map((s) => (
                  <section key={s.label}>
                    <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{s.label}</h2>
                    <p className="whitespace-pre-line text-[14px] leading-6 text-ink">{s.html ? htmlToText(s.text) : s.text}</p>
                  </section>
                ))
              )}
            </CardBody>
          </Card>
          {data.state === 'published' ? <StaffFeedback article={data} /> : null}
          <FeedbackList article={data} />
        </div>
        <div className="space-y-4">
          <WorkflowCard article={data} />
          <HistoryCard article={data} />
        </div>
      </div>
    </>
  );
}

function WorkflowCard({ article }: { article: ArticleDetail }) {
  const act = useArticleAction(article.kind, article.id);
  const [comment, setComment] = useState('');
  const [reviewDue, setReviewDue] = useState('');

  const run = (action: ArticleAction) =>
    act.mutate(
      { action, comment, ...(DATED.includes(action) && reviewDue ? { reviewDue } : {}) },
      {
        onSuccess: () => {
          setComment('');
          setReviewDue('');
        },
      },
    );

  const dated = article.actions.some((a) => DATED.includes(a));

  return (
    <Card>
      <CardHeader
        title="Workflow"
        action={
          <Badge dot tone={STATE_TONE[article.state]}>
            {STATE_LABEL[article.state]}
          </Badge>
        }
      />
      <CardBody className="space-y-3 text-[13px]">
        {article.state === 'published' ? (
          <p className={article.reviewOverdue ? 'font-medium text-critical-ink' : 'text-ink-secondary'}>
            {article.reviewDue
              ? `${article.reviewOverdue ? 'Review overdue since' : 'Next review'} ${article.reviewDue}`
              : 'No review date set.'}
          </p>
        ) : article.state === 'in_review' ? (
          <p className="text-ink-secondary">Waiting for a reviewer to approve it or send it back.</p>
        ) : article.state === 'draft' ? (
          <p className="text-ink-secondary">A draft: only staff see it. Submit it when it is ready.</p>
        ) : (
          <p className="text-ink-secondary">Retired: hidden from the portal.</p>
        )}

        {article.actions.length === 0 ? (
          <p className="text-ink-muted">A reviewer takes it from here.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor="kb-comment" className="block font-medium text-ink">
                Comment{article.actions.includes('send_back') ? ' (needed to send it back)' : ''}
              </label>
              <textarea id="kb-comment" rows={3} className={CONTROL} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            {dated ? (
              <div className="space-y-1.5">
                <label htmlFor="kb-review-due" className="block font-medium text-ink">
                  Next review (leave empty for the usual interval)
                </label>
                <Input id="kb-review-due" type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} />
              </div>
            ) : null}
            {act.isError ? (
              <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
                {errorText(act.error, 'That could not be done.')}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {article.actions.map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === 'send_back' || action === 'retire' ? 'secondary' : 'primary'}
                  disabled={action === 'send_back' && !comment.trim()}
                  loading={act.isPending && act.variables?.action === action}
                  onClick={() => run(action)}
                >
                  {ACTION_LABEL[action]}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function HistoryCard({ article }: { article: ArticleDetail }) {
  return (
    <Card>
      <CardHeader title="History" />
      <CardBody>
        {article.history.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Written before the review workflow; published as it was.</p>
        ) : (
          <ol className="space-y-2 text-[13px]" aria-label="Article history">
            {article.history.map((h, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{EVENT_LABEL[h.action]}</span>
                <span className="text-ink-muted">
                  {' '}
                  · {h.by || 'someone'} · {dateTimeText(h.at)}
                </span>
                {h.comment ? <p className="whitespace-pre-line text-ink-secondary">{h.comment}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

function StaffFeedback({ article }: { article: ArticleDetail }) {
  const rate = useRateArticle(article.kind, article.id);
  return <ArticleFeedback initial={article.myFeedback} onSubmit={(input) => rate.mutateAsync(input)} />;
}

/** What readers said: the score, and every comment, for the author. */
function FeedbackList({ article }: { article: ArticleDetail }) {
  const h = article.helpfulness;
  return (
    <Card>
      <CardHeader
        title="Reader feedback"
        subtitle={h.score === null ? 'No votes yet' : `${h.score}% found it helpful · ${h.yes} yes, ${h.no} no`}
      />
      {article.feedback.length ? (
        <CardBody>
          <ul className="divide-y divide-line text-[13px]" aria-label="Feedback">
            {article.feedback.map((f, i) => (
              <li key={i} className="flex items-start gap-2 py-2">
                {f.helpful ? (
                  <ThumbsUp className="mt-0.5 size-4 shrink-0 text-good" aria-label="Helpful" />
                ) : (
                  <ThumbsDown className="mt-0.5 size-4 shrink-0 text-critical" aria-label="Not helpful" />
                )}
                <div className="min-w-0">
                  {f.comment ? <p className="whitespace-pre-line text-ink">{f.comment}</p> : null}
                  <p className="text-ink-muted">
                    {f.by} · {f.source === 'portal' ? 'portal' : 'staff'} · {dateTimeText(f.at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}
    </Card>
  );
}
