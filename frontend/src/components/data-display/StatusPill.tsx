import { Badge } from '@/components/ui';
import type { Tone } from '@/theme';

/** Status pill with a leading dot. Tone comes from the feature (e.g. status-resolved). */
export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}
