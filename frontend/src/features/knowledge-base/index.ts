// knowledge-base: public API. Other features may import ONLY from this file.
export { KnowledgeListPage } from './pages/KnowledgeListPage';
export { KnowledgeArticlePage } from './pages/KnowledgeArticlePage';
export { KnowledgeSettingsPage } from './pages/KnowledgeSettingsPage';
// "Was this helpful?", also on the portal's article page.
export { ArticleFeedback } from './components/ArticleFeedback';
export type {
  ArticleAction,
  ArticleActionInput,
  ArticleDetail,
  ArticleFeedback as ArticleFeedbackEntry,
  ArticleKind,
  ArticleList,
  ArticleListQuery,
  ArticleState,
  ArticleSummary,
  FeedbackInput,
  Helpfulness,
  KnowledgeSettings,
} from './types';
