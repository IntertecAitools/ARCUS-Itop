import type { BadgeTone } from '@/components/ui';
import type { ArticleAction, ArticleKind, ArticleState } from '../types';

export const STATE_LABEL: Record<ArticleState, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  retired: 'Retired',
};

export const STATE_TONE: Record<ArticleState, BadgeTone> = {
  draft: 'neutral',
  in_review: 'info',
  published: 'good',
  retired: 'warning',
};

export const KIND_LABEL: Record<ArticleKind, string> = { faq: 'FAQ', known_error: 'Known error' };

export const ACTION_LABEL: Record<ArticleAction, string> = {
  submit: 'Submit for review',
  approve: 'Approve and publish',
  send_back: 'Send back',
  reviewed: 'Mark reviewed',
  retire: 'Retire',
  restore: 'Restore to draft',
};

/** iTop keeps a FAQ's answer as HTML: shown here as text, paragraphs kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
