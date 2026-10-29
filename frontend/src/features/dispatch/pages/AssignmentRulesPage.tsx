import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, IconButton, Input, Select, Skeleton } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import {
  useAssignmentRules,
  useRuleOptions,
  useSaveAssignmentRules,
  useTestAssignmentRules,
} from '../api/useDispatch';
import type { AssignmentRule, AssignmentRules, RoutingFacts, TicketType } from '../types';

const ANY = { value: '', label: 'Any' };

const TYPE_OPTIONS = [
  ANY,
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Service request' },
];

/** A rule as the form edits it: every criterion a string, "" meaning any. */
type Draft = Required<Omit<AssignmentRule, 'ticketType'>> & { ticketType: TicketType | '' };

const toDraft = (r: AssignmentRule): Draft => ({
  id: r.id,
  name: r.name,
  enabled: r.enabled,
  ticketType: r.ticketType ?? '',
  organizationId: r.organizationId ?? '',
  serviceId: r.serviceId ?? '',
  serviceSubcategoryId: r.serviceSubcategoryId ?? '',
  teamId: r.teamId,
});

const fromDraft = (d: Draft): AssignmentRule => ({
  id: d.id,
  name: d.name.trim(),
  enabled: d.enabled,
  teamId: d.teamId,
  ...(d.ticketType ? { ticketType: d.ticketType } : {}),
  ...(d.organizationId ? { organizationId: d.organizationId } : {}),
  ...(d.serviceId ? { serviceId: d.serviceId } : {}),
  ...(d.serviceSubcategoryId ? { serviceSubcategoryId: d.serviceSubcategoryId } : {}),
});

const newId = () => `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const same = (a: AssignmentRules, b: AssignmentRules) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Which team a new ticket goes to, whether it was raised in the portal, by
 * an agent or by email. The first enabled rule that matches dispatches it;
 * a ticket no rule matches stays New for the service desk. Administrators only.
 */
export function AssignmentRulesPage() {
  const { data, isLoading, isError, error } = useAssignmentRules();
  const { data: options } = useRuleOptions();
  const save = useSaveAssignmentRules();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [notifyTeam, setNotifyTeam] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDrafts(data.rules.map(toDraft));
    setNotifyTeam(data.notifyTeam);
  }, [data]);

  const current: AssignmentRules | null = drafts ? { rules: drafts.map(fromDraft), notifyTeam } : null;
  const dirty = Boolean(data && current && !same(current, { rules: data.rules, notifyTeam: data.notifyTeam }));
  const incomplete = (drafts ?? []).some((d) => !d.name.trim() || !d.teamId);

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => list && list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      if (!list) return list;
      const next = [...list];
      const [rule] = next.splice(index, 1);
      next.splice(index + by, 0, rule!);
      return next;
    });

  const subcategoriesOf = (serviceId: string) =>
    (options?.serviceSubcategories ?? []).filter((s) => s.serviceId === serviceId);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Assignment rules' }]}
        title="Assignment rules"
        description="Which team a new ticket goes to. The first rule that matches sends it; anything else stays New for the service desk."
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the rules. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}
      {data && !data.available ? (
        <div role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          This platform cannot send tickets to a team yet, so the rules route nothing: install the
          arcus-ticket-dispatch extension.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Rules, in the order they are tried"
          subtitle={
            data?.updatedAt
              ? `Last changed by ${data.updatedBy || 'an administrator'}, ${dateTimeText(data.updatedAt)}.`
              : 'No rules yet: every new ticket waits for the service desk.'
          }
        />
        <CardBody>
          {isLoading || !drafts ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (current) save.mutate(current);
              }}
            >
              <ol className="space-y-3">
                {drafts.map((d, index) => {
                  const label = d.name.trim() || `Rule ${index + 1}`;
                  return (
                    <li key={d.id} className="rounded-control border border-line p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-6 text-[13px] font-medium text-ink-muted">{index + 1}.</span>
                        <Input
                          aria-label={`Rule ${index + 1}: name`}
                          className="min-w-48 flex-1"
                          placeholder="Name, e.g. Network outages"
                          value={d.name}
                          onChange={(e) => update(index, { name: e.target.value })}
                        />
                        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
                          <input
                            type="checkbox"
                            checked={d.enabled}
                            onChange={(e) => update(index, { enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                        <IconButton
                          label={`Move ${label} up`}
                          icon={<ArrowUp className="size-4" />}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        />
                        <IconButton
                          label={`Move ${label} down`}
                          icon={<ArrowDown className="size-4" />}
                          disabled={index === drafts.length - 1}
                          onClick={() => move(index, 1)}
                        />
                        <IconButton
                          label={`Delete ${label}`}
                          icon={<Trash2 className="size-4" />}
                          onClick={() => setDrafts((list) => list && list.filter((_, i) => i !== index))}
                        />
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        <Select
                          aria-label={`Rule ${index + 1}: category`}
                          value={d.ticketType}
                          options={TYPE_OPTIONS}
                          onChange={(e) => update(index, { ticketType: e.target.value as Draft['ticketType'] })}
                        />
                        <Select
                          aria-label={`Rule ${index + 1}: organization`}
                          value={d.organizationId}
                          options={[{ value: '', label: 'Any organization' }, ...(options?.organizations ?? [])]}
                          onChange={(e) => update(index, { organizationId: e.target.value })}
                        />
                        <Select
                          aria-label={`Rule ${index + 1}: service`}
                          value={d.serviceId}
                          options={[{ value: '', label: 'Any service' }, ...(options?.services ?? [])]}
                          onChange={(e) => update(index, { serviceId: e.target.value, serviceSubcategoryId: '' })}
                        />
                        <Select
                          aria-label={`Rule ${index + 1}: subcategory`}
                          value={d.serviceSubcategoryId}
                          disabled={!d.serviceId}
                          options={[{ value: '', label: 'Any subcategory' }, ...subcategoriesOf(d.serviceId)]}
                          onChange={(e) => update(index, { serviceSubcategoryId: e.target.value })}
                        />
                        <Select
                          aria-label={`Rule ${index + 1}: team`}
                          value={d.teamId}
                          options={[{ value: '', label: 'Send to team…' }, ...(options?.teams ?? [])]}
                          onChange={(e) => update(index, { teamId: e.target.value })}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Plus className="size-4" />}
                  onClick={() =>
                    setDrafts((list) => [
                      ...(list ?? []),
                      toDraft({ id: newId(), name: '', enabled: true, teamId: '' }),
                    ])
                  }
                >
                  Add a rule
                </Button>
              </div>

              <label className="mt-4 flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={notifyTeam} onChange={(e) => setNotifyTeam(e.target.checked)} />
                Email the team when a ticket is sent to it (by a rule or by hand)
              </label>
              {notifyTeam && data && !data.mailConfigured ? (
                <p className="mt-1 text-[12.5px] text-warning-ink">
                  No mail server is configured, so no email will be sent.
                </p>
              ) : null}
              <p className="mt-1 text-[12px] text-ink-muted">
                The email goes to the team’s own address, or to each member when the team has none.
              </p>

              {save.isError ? (
                <div role="alert" className="mt-3 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
                  {save.error instanceof Error ? save.error.message : 'The rules could not be saved.'}
                </div>
              ) : null}
              {save.isSuccess && !dirty ? (
                <div role="status" className="mt-3 rounded-card border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good-ink">
                  Rules saved. They apply to the next ticket raised.
                </div>
              ) : null}
              {incomplete ? (
                <p className="mt-3 text-[12.5px] text-ink-muted">Every rule needs a name and a team.</p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                {dirty && data ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDrafts(data.rules.map(toDraft));
                      setNotifyTeam(data.notifyTeam);
                    }}
                  >
                    Discard changes
                  </Button>
                ) : null}
                <Button type="submit" size="sm" disabled={!dirty || incomplete} loading={save.isPending}>
                  Save rules
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <RuleTester />
    </>
  );
}

/** "Where would this ticket go?", against the saved rules. */
function RuleTester() {
  const { data: options } = useRuleOptions();
  const test = useTestAssignmentRules();
  const [facts, setFacts] = useState<{ ticketType: TicketType; organizationId: string; serviceId: string; serviceSubcategoryId: string }>({
    ticketType: 'incident',
    organizationId: '',
    serviceId: '',
    serviceSubcategoryId: '',
  });
  const teamName = (id: string) => options?.teams.find((t) => t.value === id)?.label ?? `team ${id}`;
  const query: RoutingFacts = {
    ticketType: facts.ticketType,
    ...(facts.organizationId ? { organizationId: facts.organizationId } : {}),
    ...(facts.serviceId ? { serviceId: facts.serviceId } : {}),
    ...(facts.serviceSubcategoryId ? { serviceSubcategoryId: facts.serviceSubcategoryId } : {}),
  };

  return (
    <Card className="mt-6">
      <CardHeader title="Try a ticket" subtitle="Which saved rule would send it, and to whom." />
      <CardBody>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            aria-label="Try: category"
            value={facts.ticketType}
            options={TYPE_OPTIONS.slice(1)}
            onChange={(e) => setFacts((f) => ({ ...f, ticketType: e.target.value as TicketType }))}
          />
          <Select
            aria-label="Try: organization"
            value={facts.organizationId}
            options={[{ value: '', label: 'No organization' }, ...(options?.organizations ?? [])]}
            onChange={(e) => setFacts((f) => ({ ...f, organizationId: e.target.value }))}
          />
          <Select
            aria-label="Try: service"
            value={facts.serviceId}
            options={[{ value: '', label: 'No service' }, ...(options?.services ?? [])]}
            onChange={(e) => setFacts((f) => ({ ...f, serviceId: e.target.value, serviceSubcategoryId: '' }))}
          />
          <Select
            aria-label="Try: subcategory"
            value={facts.serviceSubcategoryId}
            disabled={!facts.serviceId}
            options={[
              { value: '', label: 'No subcategory' },
              ...(options?.serviceSubcategories ?? []).filter((s) => s.serviceId === facts.serviceId),
            ]}
            onChange={(e) => setFacts((f) => ({ ...f, serviceSubcategoryId: e.target.value }))}
          />
          <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate(query)}>
            Where would it go?
          </Button>
        </div>
        {test.data ? (
          <p role="status" className="mt-3 text-[13px] text-ink">
            {test.data.rule
              ? `“${test.data.rule.name}” sends it to ${teamName(test.data.rule.teamId)}.`
              : 'No rule matches: it stays New for the service desk.'}
          </p>
        ) : null}
        {test.isError ? (
          <p role="alert" className="mt-3 text-[13px] text-critical-ink">
            {test.error instanceof Error ? test.error.message : 'The rules could not be tried.'}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
