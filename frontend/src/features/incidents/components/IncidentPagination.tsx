import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';

interface Props {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}

export function IncidentPagination({ page, pages, total, limit, onPage }: Props) {
  if (total === 0) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
      {/* State the range, not just the page number — "page 3 of 7" doesn't say
          how many records that is. */}
      <p className="text-[13px] text-ink-muted">
        <span className="font-medium text-ink-secondary tabular-nums">
          {first}–{last}
        </span>{' '}
        of <span className="font-medium text-ink-secondary tabular-nums">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          leadingIcon={<ChevronLeft className="size-4" />}
        >
          Previous
        </Button>
        <span className="text-[13px] text-ink-muted tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          trailingIcon={<ChevronRight className="size-4" />}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
