import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Pencil, Siren } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Avatar, Badge, Button, buttonClasses, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { PendingNote, PriorityBadge, StatusPill, OperationalStatusPill } from '@/components/data-display';
import { friendlyDateTime } from '@/lib/utils';
import { humanise, toPlainText } from '../lib/itop-text';
import { useIncident } from '../api/useIncidents';
import { IncidentActions } from '../components/IncidentActions';
import { IncidentCaseLog } from '../components/IncidentCaseLog';
import { IncidentEditDialog } from '../components/IncidentEditDialog';
import { MajorIncidentPanel } from '../components/MajorIncidentPanel';
import { TicketHandlingPanel } from '@/features/ticket-handling';
import type { IncidentDetail } from '../types';

function Field({ label, children }: { label: string; children?: ReactNode }) {
  if (children === undefined || children === null || children === '') return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-[12.5px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-end text-[13px] text-ink">{children}</dd>
    </div>
  );
}

function SlaBanner({ sla }: { sla: IncidentDetail['sla'] }) {
  if (!sla.ttoBreached && !sla.ttrBreached) return null;

  const breached = [
    sla.ttoBreached ? 'time to own' : null,
    sla.ttrBreached ? 'time to resolve' : null,
  ].filter(Boolean);

  return (
    <div
      role="alert"
      className="mb-4 flex items-center gap-2.5 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>
        SLA breached on <span className="font-semibold">{breached.join(' and ')}</span>.
      </span>
    </div>
  );
}

/** On hold: why, and when someone acts on it again; louder once overdue. */
function PendingBanner({ pending }: { pending: NonNullable<IncidentDetail['pending']> }) {
  return (
    <div
      role={pending.overdue ? 'alert' : 'status'}
      className={
        pending.overdue
          ? 'mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3'
          : 'mb-4 rounded-card border border-line bg-surface-sunken px-4 py-3'
      }
    >
      <p className="mb-1 text-[12px] font-semibold tracking-wide text-ink-secondary uppercase">On hold</p>
      <PendingNote pending={pending} className="text-[13px]" />
    </div>
  );
}

export function IncidentDetailPage() {
  const { id = '' } = useParams();
  const { data: incident, isLoading, isError, error } = useIncident(id);
  const [editing, setEditing] = useState(false);

  if (isError) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Incidents', to: '/incidents' }, { label: id }]}
          title="Incident not found"
        />
        <Card>
          <CardBody>
            <p className="py-6 text-center text-[13px] text-ink-secondary">
              {error instanceof Error ? error.message : 'That incident could not be loaded.'}
            </p>
            <div className="flex justify-center">
              <Link to="/incidents" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Back to incidents
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (isLoading || !incident) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Incidents', to: '/incidents' }]}
          title="Loading..."
        />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Skeleton className="h-64 xl:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const actions = (
    <>
      {incident.status !== 'closed' ? (
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Pencil className="size-4" />}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
      ) : null}
      <Link
        to="/incidents"
        className={buttonClasses({ variant: 'secondary', size: 'sm' })}
      >
        <ArrowLeft className="me-1.5 size-4 rtl:-scale-x-100" />
        All incidents
      </Link>
    </>
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Incidents', to: '/incidents' },
          { label: incident.ref },
        ]}
        title={incident.summary}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink-secondary">{incident.ref}</span>
            {incident.major ? (
              <Badge tone="critical" size="sm" icon={<Siren className="size-3" />}>
                Major incident
              </Badge>
            ) : null}
            <StatusPill status={incident.status} size="sm" />
            <PriorityBadge priority={incident.priority} size="sm" />
            <span className="text-ink-muted">
              Raised {friendlyDateTime(incident.createdAt)}
            </span>
          </span>
        }
        actions={actions}
      />
      <SlaBanner sla={incident.sla} />
      {incident.pending ? <PendingBanner pending={incident.pending} /> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Description" />
            <CardBody>
              <p className="text-[13.5px] whitespace-pre-wrap text-ink-secondary">
                {toPlainText(incident.description) || 'No description was provided.'}
              </p>
            </CardBody>
          </Card>

          {incident.resolution ? (
            <Card>
              <CardHeader
                title="Resolution"
                subtitle={
                  incident.resolutionCode ? `Code: ${humanise(incident.resolutionCode)}` : undefined
                }
              />
              <CardBody>
                <p className="text-[13.5px] whitespace-pre-wrap text-ink-secondary">
                  {toPlainText(incident.resolution)}
                </p>
              </CardBody>
            </Card>
          ) : null}

          {incident.privateLog && incident.privateLog.length > 0 ? (
            <Card>
              <CardHeader title="Private Log" />
              <CardBody>
                <IncidentCaseLog id={incident.id} entries={incident.privateLog} />
              </CardBody>
            </Card>
          ) : null}

          <IncidentCaseLog id={incident.id} entries={incident.log} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Actions" />
            <CardBody>
              <IncidentActions incident={incident} />
            </CardBody>
          </Card>

          <MajorIncidentPanel incident={incident} />

          <TicketHandlingPanel ticketClass="Incident" id={incident.id} />

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="divide-y divide-line">
                <Field label="Assignee">
                  {incident.assignee ? (
                    <span className="flex items-center justify-end gap-2">
                      <Avatar name={incident.assignee.name} size="xs" />
                      {incident.assignee.name}
                    </span>
                  ) : (
                    <span className="text-ink-muted">Unassigned</span>
                  )}
                </Field>
                <Field label="Team">{incident.team?.name}</Field>
                <Field label="Caller">{incident.caller?.name}</Field>
                <Field label="Organisation">{incident.organization?.name}</Field>
                <Field label="Service">{incident.service}</Field>
                <Field label="Category">{incident.serviceSubcategory}</Field>
                <Field label="Priority">
                  <PriorityBadge priority={incident.priority} size="sm" />
                </Field>
                <Field label="Operational Status">
                  {incident.operationalStatus ? (
                    <OperationalStatusPill status={incident.operationalStatus} size="sm" />
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </Field>
                <Field label="Urgency">{humanise(incident.urgency)}</Field>
                <Field label="Impact">{humanise(incident.impact)}</Field>
                <Field label="Origin">{humanise(incident.origin)}</Field>
                {incident.escalationFlagDisplay && (
                  <Field label="Escalation Flag">{incident.escalationFlagDisplay}</Field>
                )}
                {incident.escalationReasonDisplay && (
                  <Field label="Escalation Reason">{incident.escalationReasonDisplay}</Field>
                )}
                {incident.pendingReasonDisplay && (
                  <Field label="Pending Reason">{incident.pendingReasonDisplay}</Field>
                )}
                <Field label="Operational Status">
                  {incident.operationalStatus ? (
                    <OperationalStatusPill status={incident.operationalStatus} size="sm" />
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </Field>
                <Field label="Resolved">
                  {incident.resolvedAt ? friendlyDateTime(incident.resolvedAt) : undefined}
                </Field>
                <Field label="Closed">
                  {incident.closedAt ? friendlyDateTime(incident.closedAt) : undefined}
                </Field>
                <Field label="Last updated">
                  {incident.lastUpdatedAt ? friendlyDateTime(incident.lastUpdatedAt) : undefined}
                </Field>
                {incident.assignmentDate && (
                  <Field label="Assignment Date">{friendlyDateTime(incident.assignmentDate)}</Field>
                )}
                {incident.lastPendingDate && (
                  <Field label="Last Pending Date">{friendlyDateTime(incident.lastPendingDate)}</Field>
                )}
                {incident.ttoDeadline && (
                  <Field label="TTO Escalation Deadline">{friendlyDateTime(incident.ttoDeadline)}</Field>
                )}
                {incident.ttrDeadline && (
                  <Field label="TTR Escalation Deadline">{friendlyDateTime(incident.ttrDeadline)}</Field>
                )}
                {incident.lastPendingDate && (
                  <Field label="Last Pending Date">{friendlyDateTime(incident.lastPendingDate)}</Field>
                )}
                {incident.parentRequest && (
                  <Field label="Parent Request">
                    <Link to={`/requests/${incident.parentRequest.id}`} className="text-brand-ink hover:underline">
                      {incident.parentRequest.ref} - {incident.parentRequest.title}
                    </Link>
                  </Field>
                )}
                {incident.parentProblem && (
                  <Field label="Parent Problem">
                    <Link to={`/problems/${incident.parentProblem.id}`} className="text-brand-ink hover:underline">
                      {incident.parentProblem.ref} - {incident.parentProblem.title}
                    </Link>
                  </Field>
                )}
                {incident.parentChange && (
                  <Field label="Parent Change">
                    <Link to={`/changes/${incident.parentChange.id}`} className="text-brand-ink hover:underline">
                      {incident.parentChange.ref} - {incident.parentChange.title}
                    </Link>
                  </Field>
                )}
                <Field label="Related Requests">
                  {incident.relatedRequests && incident.relatedRequests.length > 0 ? (
                    <ul className="space-y-1">
                      {incident.relatedRequests.map((req) => (
                        <li key={req.id}>
                          <Link to={`/requests/${req.id}`} className="text-brand-ink hover:underline">
                            {req.ref} - {req.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-muted">None</span>
                  )}
                </Field>
                {incident.resolution && (
                  <Field label="Resolution">{toPlainText(incident.resolution)}</Field>
                )}
                {incident.resolutionCode && (
                  <Field label="Resolution Code">{humanise(incident.resolutionCode)}</Field>
                )}
                {incident.timeSpent && (
                  <Field label="Time Spent">{incident.timeSpent}</Field>
                )}
                {incident.userSatisfaction && (
                  <Field label="User Satisfaction">{incident.userSatisfaction}</Field>
                )}
                {incident.userComment && (
                  <Field label="User Comment">{incident.userComment}</Field>
                )}
                {incident.sla.ttoPassed !== undefined && (
                  <Field label="SLA TTO Passed">{incident.sla.ttoPassed ? 'Yes' : 'No'}</Field>
                )}
                {incident.sla.ttoOver !== undefined && (
                  <Field label="SLA TTO Over">{incident.sla.ttoOver ? 'Yes' : 'No'}</Field>
                )}
                {incident.sla.ttrPassed !== undefined && (
                  <Field label="SLA TTR Passed">{incident.sla.ttrPassed ? 'Yes' : 'No'}</Field>
                )}
                {incident.sla.ttrOver !== undefined && (
                  <Field label="SLA TTR Over">{incident.sla.ttrOver ? 'Yes' : 'No'}</Field>
                )}
                {incident.escalationFlagDisplay && (
                  <Field label="Escalation Flag">{incident.escalationFlagDisplay}</Field>
                )}
                {incident.escalationReasonDisplay && (
                  <Field label="Escalation Reason">{incident.escalationReasonDisplay}</Field>
                )}
                {incident.pendingReasonDisplay && (
                  <Field label="Pending Reason">{incident.pendingReasonDisplay}</Field>
                )}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      {editing ? (
        <IncidentEditDialog incident={incident} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}