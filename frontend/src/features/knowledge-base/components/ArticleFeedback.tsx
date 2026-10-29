import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FeedbackInput } from '../types';

const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

interface ArticleFeedbackProps {
  /** Sends the vote; the comment comes in a second call when the reader adds one. */
  onSubmit: (input: FeedbackInput) => Promise<unknown>;
  /** The reader's earlier vote, when there was one. */
  initial?: { helpful: boolean; comment: string } | null;
  className?: string;
}

/**
 * "Was this helpful?" Yes or No, then an optional comment. One vote per
 * reader: voting again replaces it. Used in the portal and in staff search.
 */
export function ArticleFeedback({ onSubmit, initial = null, className }: ArticleFeedbackProps) {
  const [helpful, setHelpful] = useState<boolean | null>(initial?.helpful ?? null);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [stage, setStage] = useState<'ask' | 'comment' | 'thanks'>(initial ? 'thanks' : 'ask');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const send = async (input: FeedbackInput, next: 'comment' | 'thanks') => {
    setPending(true);
    setError('');
    try {
      await onSubmit(input);
      setStage(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your feedback could not be sent.');
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label="Was this helpful?" className={cn('rounded-card border border-line p-4', className)}>
      {stage === 'thanks' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-ink-secondary">
          <span role="status">
            Thanks for your feedback{helpful === null ? '' : helpful ? ': glad it helped.' : ': we’ll use it to improve this article.'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setStage('ask')}>
            Change my answer
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[14px] font-medium text-ink">Was this helpful?</span>
            {[true, false].map((value) => (
              <Button
                key={String(value)}
                size="sm"
                variant={helpful === value ? 'primary' : 'secondary'}
                aria-pressed={helpful === value}
                disabled={pending}
                leadingIcon={value ? <ThumbsUp className="size-4" /> : <ThumbsDown className="size-4" />}
                onClick={() => {
                  setHelpful(value);
                  void send({ helpful: value, comment }, 'comment');
                }}
              >
                {value ? 'Yes' : 'No'}
              </Button>
            ))}
          </div>
          {stage === 'comment' && helpful !== null ? (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send({ helpful, comment }, 'thanks');
              }}
            >
              <label htmlFor="article-feedback-comment" className="block text-[13px] text-ink-secondary">
                {helpful ? 'Anything to add? (optional)' : 'What was missing or wrong? (optional)'}
              </label>
              <textarea
                id="article-feedback-comment"
                rows={3}
                className={CONTROL}
                value={comment}
                maxLength={2000}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setStage('thanks')}>
                  Skip
                </Button>
                <Button type="submit" size="sm" loading={pending}>
                  Send
                </Button>
              </div>
            </form>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-critical-ink">
          {error}
        </p>
      ) : null}
    </section>
  );
}
