import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  ArticleAction,
  ArticleActionInput,
  ArticleDetail,
  ArticleKind,
  ArticleList,
  ArticleState,
  FeedbackInput,
  KnowledgeSettings,
} from '@/features/knowledge-base';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Mock knowledge articles, mirroring the BFF's workflow: draft -> in review
 * -> published -> retired, one vote per reader. The mock caller reviews
 * (as an administrator would) and wrote the draft FAQ 3.
 */
const MOVES: Record<ArticleAction, { from: ArticleState; to: ArticleState }> = {
  submit: { from: 'draft', to: 'in_review' },
  approve: { from: 'in_review', to: 'published' },
  send_back: { from: 'in_review', to: 'draft' },
  reviewed: { from: 'published', to: 'published' },
  retire: { from: 'published', to: 'retired' },
  restore: { from: 'retired', to: 'draft' },
};

const article = (
  kind: ArticleKind,
  id: string,
  title: string,
  state: ArticleState,
  extra: Partial<ArticleDetail> = {},
): ArticleDetail => ({
  kind,
  id,
  title,
  summary: kind === 'faq' ? 'Short answer for the list.' : 'What users see when it happens.',
  category: kind === 'faq' ? 'Accounts' : 'Network',
  state,
  author: 'agent.demo',
  reviewDue: state === 'published' ? '2027-03-01' : '',
  reviewOverdue: false,
  helpfulness: { yes: 0, no: 0, score: null },
  recordClass: kind === 'faq' ? 'FAQ' : 'KnownError',
  sections:
    kind === 'faq'
      ? [
          { label: 'Summary', text: 'Short answer for the list.', html: false },
          { label: 'Answer', text: '<p>Open <b>My profile</b>, then Change password.</p>', html: true },
        ]
      : [{ label: 'Symptom', text: 'The VPN drops every few minutes.', html: false }],
  history: [{ at: '2026-10-01T09:00:00.000Z', by: 'Agent Demo', action: 'created', comment: '' }],
  feedback: [],
  actions: [],
  myFeedback: null,
  ...extra,
});

const articles = new Map<string, ArticleDetail>(
  [
    article('faq', '1', 'How do I reset my password?', 'published', {
      helpfulness: { yes: 8, no: 2, score: 80 },
      feedback: [{ helpful: false, comment: 'The screenshot is out of date.', by: 'Pat Reader', source: 'portal', at: '2026-10-20T10:00:00.000Z' }],
    }),
    article('faq', '2', 'How do I connect to the VPN?', 'published', { reviewDue: '2026-09-01', reviewOverdue: true }),
    article('faq', '3', 'Map a network printer', 'draft'),
    article('known_error', '4', 'VPN drops on hotel Wi-Fi', 'in_review'),
  ].map((a) => [`${a.kind}:${a.id}`, a]),
);

let settings: KnowledgeSettings = { reviewerProfiles: ['Document author'], reviewIntervalDays: 180, updatedAt: '', updatedBy: '' };

const withActions = (a: ArticleDetail): ArticleDetail => ({
  ...a,
  actions: (Object.keys(MOVES) as ArticleAction[]).filter((x) => MOVES[x].from === a.state),
});

const refused = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

export const knowledgeHandlers = [
  http.get(url('/knowledge/articles'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const q = (params.get('q') ?? '').toLowerCase();
    const state = params.get('state');
    const kind = params.get('kind');
    const all = [...articles.values()].filter((a) => (!kind || a.kind === kind) && (!q || a.title.toLowerCase().includes(q)));
    const counts = { draft: 0, in_review: 0, published: 0, retired: 0, review_due: 0 };
    for (const a of all) {
      counts[a.state] += 1;
      if (a.reviewOverdue) counts.review_due += 1;
    }
    const items = all
      .filter((a) => !state || (state === 'review_due' ? a.reviewOverdue : a.state === state))
      .map(({ recordClass: _c, sections: _s, history: _h, feedback: _f, actions: _a, myFeedback: _m, ...summary }) => summary);
    return HttpResponse.json<ArticleList>({ items, counts, canReview: true });
  }),

  http.get(url('/knowledge/articles/:kind/:id'), ({ params }) => {
    const a = articles.get(`${params.kind}:${params.id}`);
    return a ? HttpResponse.json(withActions(a)) : refused(404, 'not_found', 'That article was not found.');
  }),

  http.post(url('/knowledge/articles/:kind/:id/actions'), async ({ params, request }) => {
    const key = `${params.kind}:${params.id}`;
    const a = articles.get(key);
    if (!a) return refused(404, 'not_found', 'That article was not found.');
    const body = (await request.json()) as ArticleActionInput;
    const move = MOVES[body.action];
    if (a.state !== move.from) return refused(409, 'conflict', `The article is ${a.state.replace('_', ' ')}.`);
    if (body.action === 'send_back' && !body.comment.trim()) {
      return refused(400, 'bad_request', 'Say what to change: a comment is needed to send the article back.');
    }
    const next: ArticleDetail = {
      ...a,
      state: move.to,
      reviewDue: move.to === 'published' ? (body.reviewDue ?? '2027-04-28') : '',
      reviewOverdue: false,
      history: [{ at: new Date().toISOString(), by: 'Mock Administrator', action: body.action, comment: body.comment }, ...a.history],
    };
    articles.set(key, next);
    return HttpResponse.json(withActions(next));
  }),

  http.post(url('/knowledge/articles/:kind/:id/feedback'), async ({ params, request }) => {
    const key = `${params.kind}:${params.id}`;
    const a = articles.get(key);
    if (!a || a.state !== 'published') return refused(404, 'not_found', 'That article is not published.');
    const body = (await request.json()) as FeedbackInput;
    const yes = a.helpfulness.yes + (body.helpful ? 1 : 0);
    const no = a.helpfulness.no + (body.helpful ? 0 : 1);
    const helpfulness = { yes, no, score: Math.round((100 * yes) / (yes + no)) };
    articles.set(key, {
      ...a,
      helpfulness,
      myFeedback: { helpful: body.helpful, comment: body.comment },
      feedback: [{ helpful: body.helpful, comment: body.comment, by: 'Mock Administrator', source: 'staff', at: new Date().toISOString() }, ...a.feedback],
    });
    return HttpResponse.json(helpfulness);
  }),

  http.get(url('/admin/knowledge-settings'), () => HttpResponse.json(settings)),

  http.put(url('/admin/knowledge-settings'), async ({ request }) => {
    const body = (await request.json()) as Pick<KnowledgeSettings, 'reviewerProfiles' | 'reviewIntervalDays'>;
    settings = { ...body, updatedAt: new Date().toISOString(), updatedBy: 'admin' };
    return HttpResponse.json(settings);
  }),
];
