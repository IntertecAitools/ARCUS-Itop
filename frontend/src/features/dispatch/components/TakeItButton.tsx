import { Hand } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTakeTicket } from '../api/useDispatch';
import type { TakenTicket, TicketType } from '../types';

/**
 * "Take it": assigns a ticket waiting in a team's queue to the signed-in
 * person. Only a member of the ticket's team may; the BFF says so otherwise,
 * and the message is shown beside the button.
 */
export function TakeItButton({
  type,
  id,
  size = 'sm',
  onTaken,
}: {
  type: TicketType;
  id: string;
  size?: 'sm' | 'md';
  onTaken?: (ticket: TakenTicket) => void;
}) {
  const take = useTakeTicket();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size={size}
        leadingIcon={<Hand className="size-4" />}
        loading={take.isPending}
        onClick={() => take.mutate({ type, id }, { onSuccess: onTaken })}
      >
        Take it
      </Button>
      {take.isError ? (
        <span role="alert" className="text-[12.5px] text-critical-ink">
          {take.error instanceof Error ? take.error.message : 'It could not be taken.'}
        </span>
      ) : null}
    </span>
  );
}
