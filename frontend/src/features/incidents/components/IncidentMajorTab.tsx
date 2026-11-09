import { Skeleton } from '@/components/ui';
import { useIncident } from '../api/useIncidents';
import { MajorIncidentPanel } from './MajorIncidentPanel';

/**
 * The major-incident panel (declare / clear, child incidents, stakeholder
 * updates) as a tab of the generic incident screen, which carries every field
 * iTop offers. Fetches the incident in the shape the panel expects.
 */
export function IncidentMajorTab({ id }: { id: string }) {
  const { data: incident, isLoading } = useIncident(id);
  if (isLoading || !incident) return <Skeleton className="h-80 w-full" />;
  if (incident.extrasAvailable === false) {
    return (
      <p className="text-[13px] text-ink-muted">
        Major incidents aren’t switched on yet. Ask your administrator to enable them.
      </p>
    );
  }
  return <MajorIncidentPanel incident={incident} />;
}
