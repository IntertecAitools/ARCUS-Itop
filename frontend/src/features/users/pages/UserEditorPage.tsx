import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useCreateUser, useProfiles, useSetPassword, useUpdateUser, useUser } from '../api/users.api';
import { ProfilePicker, RecordPicker } from '../components/AccessFields';
import type { AccountType, Option } from '../types';

const CONTROL_LABEL = 'mb-1.5 block text-[13px] font-medium text-ink';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader title={title} {...(subtitle ? { subtitle } : {})} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

/** `/users/new` creates an account; `/users/:id` edits one. */
export function UserEditorPage() {
  const { id = '' } = useParams();
  return id === 'new' ? <NewUser /> : <EditUser id={id} />;
}

function NewUser() {
  const navigate = useNavigate();
  const create = useCreateUser();
  const { data: profiles } = useProfiles();
  const [type, setType] = useState<AccountType>('local');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [contactMode, setContactMode] = useState<'existing' | 'new'>('existing');
  const [person, setPerson] = useState<Option[]>([]);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState<Option[]>([]);
  const [profileIds, setProfileIds] = useState<number[]>([]);
  const [allowedOrgs, setAllowedOrgs] = useState<Option[]>([]);

  const portalId = profiles?.find((p) => p.name === 'Portal user')?.id;
  const contactReady = contactMode === 'existing' ? person.length === 1 : Boolean(last.trim() && email.trim() && org.length === 1);
  const ready =
    login.trim().length >= 2 && (type !== 'local' || password.length >= 8) && contactReady && profileIds.length > 0;

  const submit = () =>
    create.mutate(
      {
        type,
        login: login.trim(),
        ...(type === 'local' ? { password } : {}),
        contact:
          contactMode === 'existing'
            ? { id: person[0]!.id }
            : { firstName: first.trim(), lastName: last.trim(), email: email.trim(), orgId: org[0]!.id },
        profileIds,
        allowedOrgIds: allowedOrgs.map((o) => o.id),
      },
      { onSuccess: (user) => navigate(`/users/${user.id}`, { replace: true }) },
    );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Users', to: '/users' }, { label: 'New user' }]}
        title="New user"
        description="The account is created in iTop and can sign in to this platform at once."
        actions={
          <Link to="/users" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <ArrowLeft className="mr-1.5 size-4" />
            All users
          </Link>
        }
      />
      <ErrorNote error={create.error} />

      <Section title="Sign-in">
        <div>
          <span className={CONTROL_LABEL}>How this person signs in</span>
          <div className="flex flex-wrap gap-4 text-[13px] text-ink">
            {(
              [
                ['local', 'Password kept by the platform'],
                ['ldap', 'Company directory (LDAP)'],
                ['external', 'External sign-in (SSO)'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="type" checked={type === value} onChange={() => setType(value)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="login" className={CONTROL_LABEL}>
              Login
            </label>
            <Input id="login" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>
          {type === 'local' ? (
            <div>
              <label htmlFor="password" className={CONTROL_LABEL}>
                Initial password
              </label>
              <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="mt-1 text-[12px] text-ink-muted">At least 8 characters. Share it securely; they can change it after signing in.</p>
            </div>
          ) : (
            <p className="text-[12px] text-ink-muted sm:pt-7">The password is checked by {type === 'ldap' ? 'the directory' : 'your sign-in provider'}.</p>
          )}
        </div>
      </Section>

      <Section title="Person" subtitle="Every account belongs to a person in the directory.">
        <div className="flex gap-4 text-[13px] text-ink">
          <label className="flex items-center gap-2">
            <input type="radio" checked={contactMode === 'existing'} onChange={() => setContactMode('existing')} />
            Existing person
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={contactMode === 'new'} onChange={() => setContactMode('new')} />
            New person
          </label>
        </div>
        {contactMode === 'existing' ? (
          <RecordPicker className="Person" value={person} onChange={setPerson} single placeholder="Search people by name…" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="first" className={CONTROL_LABEL}>First name</label>
              <Input id="first" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <label htmlFor="last" className={CONTROL_LABEL}>Last name</label>
              <Input id="last" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
            <div>
              <label htmlFor="email" className={CONTROL_LABEL}>Email</label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <span className={CONTROL_LABEL}>Organisation</span>
              <RecordPicker className="Organization" value={org} onChange={setOrg} single placeholder="Search organisations…" />
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Profiles"
        subtitle={
          portalId && profileIds.includes(portalId)
            ? 'With "Portal user" this is an end-user account.'
            : 'What this person may do. Pick "Portal user" for an end user.'
        }
      >
        <ProfilePicker value={profileIds} onChange={setProfileIds} />
      </Section>

      <Section title="Organisations" subtitle="Limit the account to these organisations. Leave empty for all.">
        <RecordPicker className="Organization" value={allowedOrgs} onChange={setAllowedOrgs} placeholder="Search organisations…" />
      </Section>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={!ready} loading={create.isPending}>
          Create account
        </Button>
      </div>
    </>
  );
}

function EditUser({ id }: { id: string }) {
  const { data: user, isLoading, error } = useUser(id);
  const update = useUpdateUser(id);
  const setPassword = useSetPassword(id);
  const [profileIds, setProfileIds] = useState<number[]>([]);
  const [allowedOrgs, setAllowedOrgs] = useState<Option[]>([]);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (!user) return;
    setProfileIds(user.profileIds);
    setAllowedOrgs(user.allowedOrgs.map((o) => ({ id: o.id, label: o.name })));
  }, [user]);

  const crumbs = [{ label: 'Home', to: '/' }, { label: 'Users', to: '/users' }, { label: user?.login ?? `#${id}` }];
  if (isLoading || !user) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title={error ? 'Account not found' : 'Loading…'} />
        {error ? <ErrorNote error={error} /> : <Skeleton className="h-96" />}
      </>
    );
  }

  const enabled = user.status === 'enabled';

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title={user.name || user.login}
        description={`${user.login} · ${user.email || 'no email'} · ${enabled ? 'Enabled' : 'Disabled'}`}
        actions={
          <div className="flex gap-2">
            <Button
              variant={enabled ? 'danger' : 'primary'}
              size="sm"
              loading={update.isPending && update.variables?.status !== undefined}
              onClick={() => update.mutate({ status: enabled ? 'disabled' : 'enabled' })}
            >
              {enabled ? 'Disable account' : 'Enable account'}
            </Button>
            <Link to="/users" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <ArrowLeft className="mr-1.5 size-4" />
              All users
            </Link>
          </div>
        }
      />
      <ErrorNote error={update.error ?? setPassword.error} />
      {update.isSuccess ? (
        <p role="status" className="mb-4 text-[13px] text-good-ink">Saved. The user will sign in again to pick up the change.</p>
      ) : null}

      <Section title="Profiles">
        <ProfilePicker value={profileIds} onChange={setProfileIds} />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => update.mutate({ profileIds })} disabled={profileIds.length === 0}>
            Save profiles
          </Button>
        </div>
      </Section>

      <Section title="Organisations" subtitle="Limit the account to these organisations. Empty means all.">
        <RecordPicker className="Organization" value={allowedOrgs} onChange={setAllowedOrgs} placeholder="Search organisations…" />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => update.mutate({ allowedOrgIds: allowedOrgs.map((o) => o.id) })}>
            Save organisations
          </Button>
        </div>
      </Section>

      {user.type === 'local' ? (
        <Section title="Password" subtitle="Set a new password. The user is signed out everywhere.">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-72">
              <label htmlFor="reset" className={CONTROL_LABEL}>New password</label>
              <Input id="reset" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={newPassword.length < 8}
              loading={setPassword.isPending}
              onClick={() => setPassword.mutate(newPassword, { onSuccess: () => setNewPassword('') })}
            >
              Set password
            </Button>
          </div>
          {setPassword.isSuccess ? <p role="status" className={cn('text-[13px] text-good-ink')}>Password set.</p> : null}
        </Section>
      ) : (
        <p className="text-[13px] text-ink-muted">
          This account signs in through {user.type === 'ldap' ? 'the company directory' : 'an external provider'}; its password is managed there.
        </p>
      )}
    </>
  );
}
