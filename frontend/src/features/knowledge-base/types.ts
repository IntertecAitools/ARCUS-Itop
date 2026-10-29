// knowledge-base: feature types. Mirrors backend/src/modules/knowledge/knowledge.types.ts; keep the two identical.

/** The iTop records an article is: a FAQ, or a known error. */
export type ArticleKind = 'faq' | 'known_error';

/**
 * draft -> in_review -> published -> retired. Kept by the BFF: iTop's FAQ
 * and KnownError have no state. An article the workflow never saw (made in
 * iTop before it, or by an import) counts as published.
 */
export type ArticleState = 'draft' | 'in_review' | 'published' | 'retired';

export type ArticleAction =
  /** draft -> in_review (the author). */
  | 'submit'
  /** in_review -> published (a reviewer). */
  | 'approve'
  /** in_review -> draft, with comments (a reviewer). */
  | 'send_back'
  /** published -> published, with the next review date (a reviewer). */
  | 'reviewed'
  /** published -> retired (a reviewer). */
  | 'retire'
  /** retired -> draft (a reviewer). */
  | 'restore';

export interface Helpfulness {
  yes: number;
  no: number;
  /** Percentage of 'yes', null with no votes. */
  score: number | null;
}

export interface ArticleSummary {
  kind: ArticleKind;
  id: string;
  title: string;
  summary: string;
  category: string;
  state: ArticleState;
  /** Login of whoever wrote or last submitted it; '' when unknown. */
  author: string;
  /** YYYY-MM-DD, when a published article is next due for review; ''. */
  reviewDue: string;
  /** Published and past its review date. */
  reviewOverdue: boolean;
  helpfulness: Helpfulness;
}

export interface ArticleEvent {
  /** ISO. */
  at: string;
  by: string;
  action: ArticleAction | 'created';
  comment: string;
}

export interface ArticleFeedback {
  helpful: boolean;
  comment: string;
  /** The person's name, or their login. */
  by: string;
  source: 'portal' | 'staff';
  /** ISO. */
  at: string;
}

export interface ArticleDetail extends ArticleSummary {
  /** The record behind it, for the record screen: FAQ or KnownError. */
  recordClass: string;
  /** The body, in labelled parts (FAQ: summary and answer; known error: symptom, cause, workaround, solution). */
  sections: Array<{ label: string; text: string; html: boolean }>;
  history: ArticleEvent[];
  /** Newest first. */
  feedback: ArticleFeedback[];
  /** What the caller may do now. */
  actions: ArticleAction[];
  /** The caller's own vote, when they gave one. */
  myFeedback: { helpful: boolean; comment: string } | null;
}

export interface ArticleList {
  items: ArticleSummary[];
  counts: Record<ArticleState | 'review_due', number>;
  /** The caller reviews articles (approves, sends back, retires). */
  canReview: boolean;
}

export interface ArticleListQuery {
  q?: string;
  state?: ArticleState | 'review_due';
  kind?: ArticleKind;
}

export interface ArticleActionInput {
  action: ArticleAction;
  comment: string;
  /** YYYY-MM-DD for approve / reviewed; defaults to today plus the review interval. */
  reviewDue?: string;
}

export interface FeedbackInput {
  helpful: boolean;
  comment: string;
}

export interface KnowledgeSettings {
  /** iTop profiles whose holders review articles (administrators always may). */
  reviewerProfiles: string[];
  /** Days from publishing (or the last review) to the next review. */
  reviewIntervalDays: number;
  updatedAt: string;
  updatedBy: string;
}
