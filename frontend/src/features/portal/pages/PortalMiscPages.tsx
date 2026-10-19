import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { Button, buttonClasses, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/data-display';
import { ChangePasswordDialog } from '@/features/auth';
import { useSessionStore } from '@/stores/session.store';
import { useFaq, useFaqs, useMyRequests, useProfile, useUpdateProfile } from '../api/portal.api';

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Where an end user lands: their open requests and the ways to get help. */
export function PortalHomePage() {
  const user = useSessionStore((s) => s.user);
  const { data: open, isLoading } = useMyRequests('open', 1, '');

  return (
    <>
      <h1 className="text-[22px] font-semibold text-ink">Hello{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
      <p className="mt-1 mb-6 text-[13px] text-ink-muted">How can we help today?</p>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link to="/portal/new" className="rounded-card border border-line bg-surface-raised p-4 transition-colors hover:border-brand">
          <Plus className="mb-2 size-5 text-brand-ink" />
          <p className="text-[14px] font-medium text-ink">Raise a request</p>
          <p className="text-[12px] text-ink-muted">Report a problem or ask for something.</p>
        </Link>
        <Link to="/portal/requests" className="rounded-card border border-line bg-surface-raised p-4 transition-colors hover:border-brand">
          <p className="text-[24px] font-semibold text-ink tabular-nums">{isLoading ? '…' : (open?.total ?? 0)}</p>
          <p className="text-[14px] font-medium text-ink">Open requests</p>
          <p className="text-[12px] text-ink-muted">Follow what is in progress.</p>
        </Link>
        <Link to="/portal/help" className="rounded-card border border-line bg-surface-raised p-4 transition-colors hover:border-brand">
          <Search className="mb-2 size-5 text-brand-ink" />
          <p className="text-[14px] font-medium text-ink">Knowledge base</p>
          <p className="text-[12px] text-ink-muted">Answers to common questions.</p>
        </Link>
      </div>

      <Card>
        <CardHeader title="Your open requests" action={<Link to="/portal/requests" className="text-[13px] text-brand-ink hover:underline">See all</Link>} />
        <CardBody>
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : !open || open.items.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Nothing open. Raise a request whenever you need help.</p>
          ) : (
            <ul className="divide-y divide-line">
              {open.items.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <Link to={`/portal/requests/${t.id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-hover">
                    <span className="w-24 shrink-0 text-[12px] font-medium text-brand-ink">{t.ref}</span>
                    <span className="flex-1 truncate text-[13px] text-ink">{t.title}</span>
                    <StatusPill status={t.status} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

/** The knowledge base: iTop's FAQs, searchable. */
export function PortalFaqsPage() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useFaqs(q.trim());
  const byCategory = new Map<string, NonNullable<typeof data>>();
  for (const f of data ?? []) byCategory.set(f.category || 'General', [...(byCategory.get(f.category || 'General') ?? []), f]);

  return (
    <>
      <h1 className="mb-4 text-[20px] font-semibold text-ink">Knowledge base</h1>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the knowledge base…"
        aria-label="Search the knowledge base"
        leadingIcon={<Search className="size-4" />}
        className="mb-4 w-full sm:w-96"
      />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : byCategory.size === 0 ? (
        <p className="text-[13px] text-ink-muted">{q ? 'Nothing matches that search.' : 'No articles yet.'}</p>
      ) : (
        <div className="space-y-4">
          {[...byCategory.entries()].map(([category, items]) => (
            <Card key={category}>
              <CardHeader title={category} />
              <CardBody>
                <ul className="divide-y divide-line">
                  {items.map((f) => (
                    <li key={f.id} className="py-2.5">
                      <Link to={`/portal/help/${f.id}`} className="text-[13px] font-medium text-brand-ink hover:underline">{f.title}</Link>
                      {f.summary ? <p className="mt-0.5 text-[12px] text-ink-muted">{stripHtml(f.summary)}</p> : null}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function PortalFaqPage() {
  const { id = '' } = useParams();
  const { data: faq, isLoading, error } = useFaq(id);
  return (
    <>
      <Link to="/portal/help" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-secondary hover:text-ink">
        <ArrowLeft className="size-4" />
        Knowledge base
      </Link>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !faq ? (
        <p role="alert" className="text-[13px] text-critical-ink">{error instanceof Error ? error.message : 'Article not found.'}</p>
      ) : (
        <Card>
          <CardHeader title={faq.title} subtitle={faq.category} />
          <CardBody>
            {faq.summary ? <p className="mb-3 text-[13px] font-medium text-ink">{stripHtml(faq.summary)}</p> : null}
            <p className="text-[13px] whitespace-pre-wrap text-ink">{stripHtml(faq.description ?? '') || '—'}</p>
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** The user's own details; phone numbers are theirs to keep current. */
export function PortalProfilePage() {
  const { data: profile, isLoading } = useProfile();
  const update = useUpdateProfile();
  const [phone, setPhone] = useState('');
  const [mobile, setMobile] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setPhone(profile.phone);
    setMobile(profile.mobilePhone);
  }, [profile]);

  if (isLoading || !profile) return <Skeleton className="h-64" />;

  return (
    <>
      <h1 className="mb-4 text-[20px] font-semibold text-ink">My profile</h1>
      <Card className="mb-4">
        <CardHeader title={`${profile.firstName} ${profile.lastName}`.trim()} subtitle={[profile.function, profile.organization].filter(Boolean).join(' · ')} />
        <CardBody className="space-y-4">
          <p className="text-[13px] text-ink">{profile.email || 'No email on file'}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="mb-1.5 block text-[13px] font-medium text-ink">Phone</label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label htmlFor="mobile" className="mb-1.5 block text-[13px] font-medium text-ink">Mobile</label>
              <Input id="mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
          </div>
          {update.isError ? <p role="alert" className="text-[12px] text-critical-ink">{(update.error as Error).message}</p> : null}
          {update.isSuccess ? <p role="status" className="text-[12px] text-good-ink">Saved.</p> : null}
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className={buttonClasses({ variant: 'secondary', size: 'sm' })} onClick={() => setChangingPassword(true)}>
              Change password
            </button>
            <Button size="sm" loading={update.isPending} onClick={() => update.mutate({ phone, mobilePhone: mobile })}>
              Save
            </Button>
          </div>
        </CardBody>
      </Card>
      <p className="text-[12px] text-ink-muted">Other details are kept by your organisation. Ask the support team to change them.</p>
      {changingPassword ? <ChangePasswordDialog onClose={() => setChangingPassword(false)} /> : null}
    </>
  );
}
