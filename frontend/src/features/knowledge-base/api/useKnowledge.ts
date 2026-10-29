import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  actOnArticle,
  getArticle,
  getKnowledgeSettings,
  listArticles,
  rateArticle,
  saveKnowledgeSettings,
} from './knowledge.api';
import type { ArticleActionInput, ArticleKind, ArticleListQuery, FeedbackInput, KnowledgeSettings } from '../types';

export function useArticles(query: ArticleListQuery) {
  return useQuery({
    queryKey: queryKeys.knowledge.list({ ...query }),
    queryFn: () => listArticles(query),
    placeholderData: keepPreviousData,
  });
}

export function useArticle(kind: ArticleKind, id: string) {
  return useQuery({
    queryKey: queryKeys.knowledge.article(kind, id),
    queryFn: () => getArticle(kind, id),
    enabled: Boolean(id),
  });
}

export function useArticleAction(kind: ArticleKind, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ArticleActionInput) => actOnArticle(kind, id, input),
    onSuccess: (article) => {
      queryClient.setQueryData(queryKeys.knowledge.article(kind, id), article);
      queryClient.invalidateQueries({ queryKey: ['knowledge', 'list'] });
    },
  });
}

export function useRateArticle(kind: ArticleKind, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackInput) => rateArticle(kind, id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.all() }),
  });
}

export function useKnowledgeSettings() {
  return useQuery({ queryKey: queryKeys.knowledge.settings(), queryFn: getKnowledgeSettings });
}

export function useSaveKnowledgeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<KnowledgeSettings, 'reviewerProfiles' | 'reviewIntervalDays'>) => saveKnowledgeSettings(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.knowledge.settings(), settings);
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.all() });
    },
  });
}
