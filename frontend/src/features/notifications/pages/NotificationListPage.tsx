import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { buttonClasses, Card, Select, Tabs } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { cn } from '@/lib/utils';
import { useRules, useSentEmails, useSetRuleStatus } from '../api/notifications.api';
import { describeEvent, describeRecipients } from '../lib/describe';
import type { EmailStatus, Rule, SentEmail } from '../types';

const STATUS_OPTIONS: Array<{ value: EmailStatus; label: string }> = [
  { value: 'on', label: 'On' },
  { value: 'test', label: 'Test only' },
  { value: 'off', label: 'Off' },
];

/** Email notification rules: "when this happens, email these people". */
export function NotificationListPage() {
  const [tab, setTab] = useState<'rules' | 'sent'>('rules');
  const { data: rules, isLoading, isError, error } = useRules();
  const sent = useSentEmails(tab === 'sent');
  const setStatus = useSetRuleStatus();
  const navigate = useNavigate();


  const ruleColumns: Column<Rule>[] = [
    {
      id: 'name',
      header: 'Rule',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 font-medium text-ink">
          {row.original.event.firesFromPlatform ? null : (
            <AlertTriangle
              className="size-4 shrink-0 text-warning"
              aria-label="Only fires from iTop's own screens"
            />
          )}
          <span className="truncate">{row.original.name}</span>
        </span>
      ),
    },
    {
      id: 'when',
      header: 'When',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="block truncate">
          {describeEvent(row.original.event)}
          {row.original.event.hasCondition ? ' (with a condition)' : ''}
        </span>
      ),
    },
    {
      id: 'to',
      header: 'Email to',
      enableSorting: false,
      cell: ({ row }) => <span className="block truncate">{describeRecipients(row.original.email.to)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      size: 130,
      cell: ({ row }) => (
        // Switching a rule on or off is the most common edit: right here.
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            aria-label={`Status of ${row.original.name}`}
            className="h-8 w-28"
            value={row.original.email.status}
            disabled={setStatus.isPending}
            onChange={(e) => setStatus.mutate({ id: row.original.id, status: e.target.value as EmailStatus })}
            options={STATUS_OPTIONS}
          />
        </div>
      ),
    },
  ];

  const sentColumns: Column<SentEmail>[] = [
    { id: 'date', header: 'Sent', enableSorting: false, size: 150, cell: ({ row }) => row.original.date },
    { id: 'to', header: 'To', enableSorting: false, cell: ({ row }) => <span className="block truncate">{row.original.to || '—'}</span> },
    { id: 'subject', header: 'Subject', enableSorting: false, cell: ({ row }) => <span className="block truncate">{row.original.subject}</span> },
    { id: 'rule', header: 'Rule', enableSorting: false, cell: ({ row }) => <span className="block truncate">{row.original.rule}</span> },
    {
      id: 'result',
      header: 'Result',
      enableSorting: false,
      size: 120,
      cell: ({ row }) => (
        <span
          className={cn('block truncate', /sent/i.test(row.original.result) ? 'text-good-ink' : 'text-critical-ink')}
          title={row.original.result}
        >
          {row.original.result || '—'}
        </span>
      ),
    },
  ];

  const errorNote = (e: unknown) => (
    <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
      {e instanceof Error ? e.message : 'This could not be loaded.'}
    </div>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Notifications' }]}
        title="Notifications"
        description="Who gets an email when something happens. iTop sends them; links in them open this platform."
        actions={
          <Link to="/notifications/new" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
            <Plus className="mr-1.5 size-4" />
            New rule
          </Link>
        }
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={(id) => setTab(id as 'rules' | 'sent')}
        items={[
          { id: 'rules', label: 'Rules', count: rules?.length },
          { id: 'sent', label: 'Recently sent' },
        ]}
      />

      {tab === 'rules' ? (
        <>
          {isError ? errorNote(error) : null}
          {setStatus.error ? errorNote(setStatus.error) : null}
          <Card>
            <DataTable
              data={rules ?? []}
              columns={ruleColumns}
              isLoading={isLoading}
              loadingRows={5}
              emptyTitle="No notification rules yet"
              emptyDescription="Create one to email people when tickets are created, assigned or resolved."
              onRowClick={(rule) => navigate(`/notifications/${rule.id}`)}
            />
          </Card>
          {rules?.some((r) => !r.event.firesFromPlatform) ? (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
              <AlertTriangle className="size-3.5 text-warning" aria-hidden />
              Fires only from iTop’s own screens (its editor’s @mentions, its portal), so nothing done in this platform
              triggers it.
            </p>
          ) : null}
        </>
      ) : (
        <>
          {sent.isError ? errorNote(sent.error) : null}
          <Card>
            <DataTable
              data={sent.data ?? []}
              columns={sentColumns}
              isLoading={sent.isLoading}
              loadingRows={5}
              emptyTitle="No notification emails sent yet"
              onRowClick={(email) =>
                email.record ? navigate(`/records/${email.record.type}/${email.record.id}`) : undefined
              }
            />
          </Card>
        </>
      )}
    </>
  );
}
