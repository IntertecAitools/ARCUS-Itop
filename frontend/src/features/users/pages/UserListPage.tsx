import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { buttonClasses, Card, Input } from '@/components/ui';
import { DataTable, DEFAULT_PAGE_SIZE, type Column } from '@/components/data-display';
import { cn } from '@/lib/utils';
import { useUsers } from '../api/users.api';
import type { UserSummary } from '../types';

const TYPE_LABEL: Record<UserSummary['type'], string> = {
  local: 'Local',
  ldap: 'LDAP',
  external: 'External',
  other: 'Other',
};

/** Shown in the list without the profile iTop requires for every staff account. */
const visibleProfiles = (profiles: string[]) => profiles.filter((p) => p !== 'REST Services User');

const columns: Column<UserSummary>[] = [
  { id: 'login', header: 'Login', enableSorting: false, cell: ({ row }) => <span className="font-medium text-ink">{row.original.login}</span> },
  { id: 'name', header: 'Name', enableSorting: false, cell: ({ row }) => row.original.name || '—' },
  {
    id: 'email',
    header: 'Email',
    enableSorting: false,
    size: 280,
    // Long addresses are cut with an ellipsis (full one on hover) instead of
    // running into the Profiles column.
    cell: ({ row }) => (
      <span className="block truncate" title={row.original.email || undefined}>
        {row.original.email || '—'}
      </span>
    ),
  },
  {
    id: 'profiles',
    header: 'Profiles',
    enableSorting: false,
    cell: ({ row }) => {
      const profiles = visibleProfiles(row.original.profiles).join(', ');
      return (
        <span className="block truncate" title={profiles || undefined}>
          {profiles || '—'}
        </span>
      );
    },
  },
  { id: 'type', header: 'Sign-in', enableSorting: false, size: 90, cell: ({ row }) => TYPE_LABEL[row.original.type] },
  {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    size: 90,
    cell: ({ row }) => (
      <span className={cn(row.original.status === 'enabled' ? 'text-good-ink' : 'text-ink-muted')}>
        {row.original.status === 'enabled' ? 'Enabled' : 'Disabled'}
      </span>
    ),
  },
];

/** Everyone who can sign in to the platform: staff and end users alike. */
export function UserListPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [q, setQ] = useState('');
  const { data, isLoading, isError, error } = useUsers(page, q.trim(), pageSize);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Users' }]}
        title="Users"
        description={data ? `${data.total} account${data.total === 1 ? '' : 's'}` : 'Accounts that can sign in.'}
        actions={
          <Link to="/users/new" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
            <Plus className="me-1.5 size-4" />
            New user
          </Link>
        }
      />
      <div className="mb-4">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search by login, name or email…"
          aria-label="Search users"
          leadingIcon={<Search className="size-4" />}
          className="w-full sm:w-80"
        />
      </div>
      {isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : 'The accounts could not be loaded.'}
        </div>
      ) : null}
      <Card>
        <DataTable
          data={data?.items ?? []}
          columns={columns}
          isLoading={isLoading}
          loadingRows={8}
          emptyTitle="No accounts match"
          onRowClick={(user) => navigate(`/users/${user.id}`)}
          pagination={{
            page,
            pageSize,
            total: data?.total ?? 0,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
        />
      </Card>
    </>
  );
}
