import { Link } from 'react-router-dom';
import { BookOpen, FileText } from 'lucide-react';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { isModuleRegistered } from '@/config/modules';
import { cn, compactNumber } from '@/lib/utils';
import type { KnowledgeArticle } from '../types';
import { ViewAllLink } from './ViewAllLink';

export function KnowledgeArticlesCard({
  data,
  isLoading,
}: {
  data?: KnowledgeArticle[];
  isLoading: boolean;
}) {
  const articlesLinkable = isModuleRegistered('/knowledge');

  return (
    <Card className="h-full">
      <CardHeader title="Knowledge Articles" action={<ViewAllLink to="/knowledge" />} />
      <CardBody className="space-y-1">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
        ) : data.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="No articles yet"
            description="Published knowledge articles show up here."
          />
        ) : (
          data.map((article) => {
            const row = (
              <>
                <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">
                  {article.title}
                </span>
                <span className="shrink-0 text-[12px] text-ink-muted tabular-nums">
                  {compactNumber(article.views)} views
                </span>
              </>
            );
            const rowClass = 'flex items-center gap-2.5 rounded-control px-2 py-2';

            // Clickable only once the knowledge module is built.
            return articlesLinkable ? (
              <Link
                key={article.id}
                to={`/knowledge/${article.id}`}
                className={cn(rowClass, 'transition-colors hover:bg-surface-hover')}
              >
                {row}
              </Link>
            ) : (
              <div key={article.id} className={rowClass}>
                {row}
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
