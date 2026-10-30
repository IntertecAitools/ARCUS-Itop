import { apiClient } from '@/lib/api-client';
import type {
  ArticleActionInput,
  ArticleDetail,
  ArticleKind,
  ArticleList,
  ArticleListQuery,
  FeedbackInput,
  Helpfulness,
  KnowledgeSettings,
} from '../types';

/** Raw BFF calls for this feature. Components use the hooks, never this file. */

export function listArticles(query: ArticleListQuery) {
  return apiClient.get<ArticleList>('/knowledge/articles', { query: { ...query } });
}

export function getArticle(kind: ArticleKind, id: string) {
  return apiClient.get<ArticleDetail>(`/knowledge/articles/${kind}/${id}`);
}

export function actOnArticle(kind: ArticleKind, id: string, input: ArticleActionInput) {
  return apiClient.post<ArticleDetail>(`/knowledge/articles/${kind}/${id}/actions`, input);
}

export function rateArticle(kind: ArticleKind, id: string, input: FeedbackInput) {
  return apiClient.post<Helpfulness>(`/knowledge/articles/${kind}/${id}/feedback`, input);
}

export function getKnowledgeSettings() {
  return apiClient.get<KnowledgeSettings>('/admin/knowledge-settings');
}

export function saveKnowledgeSettings(input: Pick<KnowledgeSettings, 'reviewerProfiles' | 'reviewIntervalDays'>) {
  return apiClient.put<KnowledgeSettings>('/admin/knowledge-settings', input);
}
