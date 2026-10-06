'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, RotateCcw, Search } from 'lucide-react';
import { DatePicker } from '@/components/forms';
import { Popover } from '@/components/overlays';
import { Button, Checkbox, Input, Select } from '@/components/ui';
import { useOrgLookup, usePersonLookup, useTeamLookup } from '@/features/contacts';
import { useServiceLookup } from '@/features/service-catalog';
import { useDebounce } from '@/hooks';
import { cn } from '@/lib/utils';
import { PROBLEM_IMPACTS, PROBLEM_PRIORITIES, PROBLEM_STATUSES, PROBLEM_URGENCIES } from '../schemas';
import type { ProblemFilters } from '../types';

interface MultiFilterProps<T extends string> {
  id: string;
  label: string;
  values: readonly T[];
  selected: T[];
  optionLabel: (value: T) => string;
  onChange: (next: T[]) => void;
}

function MultiFilter<T extends string>({ id, label, values, selected, optionLabel, onChange }: MultiFilterProps<T>) {
  return (
    <Popover
      label={label}
      align="left"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-control border px-3 text-sm',
            selected.length ? 'border-primary bg-primary-soft text-primary-hover' : 'border-border bg-surface text-text',
          )}
        >
          {label}
          {selected.length > 0 && <span className="font-semibold">({selected.length})</span>}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      )}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">{label}</legend>
        {values.map((value) => (
          <Checkbox
            key={value}
            id={`${id}-${value}`}
            className="flex"
            label={optionLabel(value)}
            checked={selected.includes(value)}
            onChange={(e) => onChange(e.target.checked ? [...selected, value] : selected.filter((v) => v !== value))}
          />
        ))}
      </fieldset>
    </Popover>
  );
}

export interface ProblemFilterBarProps {
  filters: ProblemFilters;
  onChange: (patch: Partial<ProblemFilters>) => void;
  onReset: () => void;
}

export function ProblemFilterBar({ filters, onChange, onReset }: ProblemFilterBarProps) {
  const { t } = useTranslation('problems');
  const [search, setSearch] = useState(filters.q ?? '');
  const debounced = useDebounce(search.trim(), 300);

  // Debounced search text → URL
  useEffect(() => {
    if (debounced !== (filters.q ?? '')) onChange({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // URL → input (back button, reset)
  const urlQ = filters.q ?? '';
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    if (urlQ !== search.trim()) setSearch(urlQ);
  }

  const orgs = useOrgLookup('');
  const teams = useTeamLookup('');
  const agents = usePersonLookup('', { teamId: filters.teamId });
  const services = useServiceLookup('');

  const toOptions = (items?: Array<{ id: string; label: string }>) => (items ?? []).map((o) => ({ value: o.id, label: o.label }));

  const active =
    filters.status.length +
    filters.priority.length +
    filters.impact.length +
    filters.urgency.length +
    [filters.orgId, filters.teamId, filters.agentId, filters.serviceId, filters.q, filters.from, filters.to].filter(Boolean).length;

  return (
    <div role="group" aria-label={t('filters.label')} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-64 flex-1">
          <label htmlFor="problem-search" className="sr-only">
            {t('filters.search')}
          </label>
          <Input
            id="problem-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            leftIcon={<Search className="size-4" aria-hidden />}
          />
        </div>
        <MultiFilter
          id="f-status"
          label={t('fields.status')}
          values={PROBLEM_STATUSES}
          selected={filters.status}
          optionLabel={(v) => t(`status.${v}`)}
          onChange={(status) => onChange({ status })}
        />
        <MultiFilter
          id="f-priority"
          label={t('fields.priority')}
          values={PROBLEM_PRIORITIES}
          selected={filters.priority}
          optionLabel={(v) => t(`priority.${v}`)}
          onChange={(priority) => onChange({ priority })}
        />
        <MultiFilter
          id="f-impact"
          label={t('fields.impact')}
          values={PROBLEM_IMPACTS}
          selected={filters.impact}
          optionLabel={(v) => t(`impact.${v}`)}
          onChange={(impact) => onChange({ impact })}
        />
        <MultiFilter
          id="f-urgency"
          label={t('fields.urgency')}
          values={PROBLEM_URGENCIES}
          selected={filters.urgency}
          optionLabel={(v) => t(`urgency.${v}`)}
          onChange={(urgency) => onChange({ urgency })}
        />
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={onReset} leftIcon={<RotateCcw className="size-4" aria-hidden />}>
            {t('filters.reset', { count: active })}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <label className="sr-only" htmlFor="f-org">
          {t('fields.org_id')}
        </label>
        <Select
          id="f-org"
          value={filters.orgId ?? ''}
          placeholder={t('filters.allOrgs')}
          options={toOptions(orgs.data)}
          onChange={(e) => onChange({ orgId: e.target.value || undefined })}
        />
        <label className="sr-only" htmlFor="f-service">
          {t('fields.service_id')}
        </label>
        <Select
          id="f-service"
          value={filters.serviceId ?? ''}
          placeholder={t('filters.allServices')}
          options={toOptions(services.data)}
          onChange={(e) => onChange({ serviceId: e.target.value || undefined })}
        />
        <label className="sr-only" htmlFor="f-team">
          {t('fields.team_id')}
        </label>
        <Select
          id="f-team"
          value={filters.teamId ?? ''}
          placeholder={t('filters.allTeams')}
          options={toOptions(teams.data)}
          onChange={(e) => onChange({ teamId: e.target.value || undefined, agentId: undefined })}
        />
        <label className="sr-only" htmlFor="f-agent">
          {t('fields.agent_id')}
        </label>
        <Select
          id="f-agent"
          value={filters.agentId ?? ''}
          placeholder={t('filters.allAgents')}
          disabled={filters.tab === 'mine'}
          options={toOptions(agents.data)}
          onChange={(e) => onChange({ agentId: e.target.value || undefined })}
        />
        <div className="flex items-center gap-2">
          <label className="text-sm whitespace-nowrap text-text-muted" htmlFor="f-from">
            {t('filters.from')}
          </label>
          <DatePicker
            id="f-from"
            value={filters.from ?? ''}
            max={filters.to}
            onChange={(from) => onChange({ from: from || undefined })}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm whitespace-nowrap text-text-muted" htmlFor="f-to">
            {t('filters.to')}
          </label>
          <DatePicker
            id="f-to"
            value={filters.to ?? ''}
            min={filters.from}
            onChange={(to) => onChange({ to: to || undefined })}
          />
        </div>
      </div>
    </div>
  );
}
