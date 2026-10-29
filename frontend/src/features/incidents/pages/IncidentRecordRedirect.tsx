import { Navigate, useParams } from 'react-router-dom';

/**
 * `/incidents/<id>` opens the generic incident screen, which shows every field
 * iTop offers (CIs, contacts, attachments, history, editing) and carries the
 * incident's own features as tabs. Links from the dashboard, search and the
 * incidents list keep working.
 */
export function IncidentRecordRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/records/Incident/${encodeURIComponent(id)}`} replace />;
}
