import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Avatar, buttonClasses, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { PriorityBadge, StatusPill } from '@/components/data-display';
import { friendlyDateTime } from '@/lib/utils';
import { humanise, toPlainText } from '../lib/itop-text';
import { useIncident } from '../api/useIncidents';
import { IncidentActions } from '../components/IncidentActions';
import { IncidentCaseLog } from '../components/IncidentCaseLog';
import type { IncidentDetail } from '../types';

/** One labelled row in the details panel. Hidden entirely when empty. */
function Field({ label, children }: { label: string; children?: ReactNode }) {
  if (children === undefined || children === null || children === '') return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-[12.5px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] text-ink">{children}</dd>
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

export function IncidentDetailPage() {
  const { id = '' } = useParams();
  const { data: incident, isLoading, isError, error } = useIncident(id);

  if (isError) {
    return (
      <>
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
      </>
    );
  }

  if (isLoading || !incident) {
    return (
      <>
        <PageHeader
          breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Incidents', to: '/incidents' }]}
          title="Loading…"
        />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Skeleton className="h-64 xl:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }

  return (
    <>
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
            <StatusPill status={incident.status} size="sm" />
            <PriorityBadge priority={incident.priority} size="sm" />
            <span className="text-ink-muted">
              Raised {friendlyDateTime(incident.createdAt)}
            </span>
          </span>
        }
        actions={
          <Link
            to="/incidents"
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            <ArrowLeft className="mr-1.5 size-4" />
            All incidents
          </Link>
        }
      />

      <SlaBanner sla={incident.sla} />

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

          <IncidentCaseLog id={incident.id} entries={incident.log} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Actions" />
            <CardBody>
              <IncidentActions incident={incident} />
            </CardBody>
          </Card>

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
                {/* Priority is derived by iTop from urgency x impact, so it is
                    shown here rather than offered as an editable field. */}
                <Field label="Urgency">{humanise(incident.urgency)}</Field>
                <Field label="Impact">{humanise(incident.impact)}</Field>
                <Field label="Origin">{humanise(incident.origin)}</Field>
                <Field label="Resolved">
                  {incident.resolvedAt ? friendlyDateTime(incident.resolvedAt) : undefined}
                </Field>
                <Field label="Closed">
                  {incident.closedAt ? friendlyDateTime(incident.closedAt) : undefined}
                </Field>
                <Field label="Last updated">
                  {incident.lastUpdatedAt ? friendlyDateTime(incident.lastUpdatedAt) : undefined}
                </Field>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
