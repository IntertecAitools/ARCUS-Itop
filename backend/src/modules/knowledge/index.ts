/**
 * knowledge: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerKnowledgeRoutes } from "./knowledge.routes.js";
export { KnowledgeService } from "./knowledge.service.js";
export { feedbackSchema } from "./knowledge.schemas.js";
export type {
  ArticleAction,
  ArticleDetail,
  ArticleKind,
  ArticleList,
  ArticleState,
  ArticleSummary,
  FeedbackInput,
  Helpfulness,
  KnowledgeSettings,
} from "./knowledge.types.js";
