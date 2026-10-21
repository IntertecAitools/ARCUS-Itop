import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Search } from 'lucide-react';
import { Button, buttonClasses, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/data-display';
import { Eyebrow } from '@/components/public';
import { ChangePasswordDialog } from '@/features/auth';
import { useSessionStore } from '@/stores/session.store';
import { compactNumber } from '@/lib/utils';
import { useFaq, useFaqs, useMyRequests, useProfile, useUpdateProfile } from '../api/portal.api';

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Where an end user lands: their open requests and the ways to get help. */
export function PortalHomePage() {
  const user = useSessionStore((s) => s.user);
  const { data: open, isLoading } = useMyRequests('open', 1, '');
  const tile = 'group flex flex-col border-t border-line pt-6 pb-2 transition-colors hover:border-ink';

  return (
    <>
      <Eyebrow>Service portal</Eyebrow>
      <h1 className="display mt-4 text-[40px] sm:text-[56px]">Hello{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
      <p className="mt-3 mb-12 text-[17px] text-ink-secondary">How can we help today?</p>

      <div className="mb-16 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-3">
        <Link to="/portal/new" className={tile}>
          <Plus className="mb-6 size-7 stroke-[1.25] text-ink" aria-hidden />
          <p className="text-[20px] text-ink">Raise a request</p>
          <p className="mt-1 mb-6 text-[14px] text-ink-secondary">Report a problem or ask for something.</p>
          <ArrowRight className="mt-auto size-4 text-ink transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
        </Link>
        <Link to="/portal/requests" className={tile}>
          <p className="display mb-4 text-[44px] leading-none text-ink tabular-nums">{isLoading ? '…' : compactNumber(open?.total ?? 0)}</p>
          <p className="text-[20px] text-ink">Open requests</p>
          <p className="mt-1 mb-6 text-[14px] text-ink-secondary">Follow what is in progress.</p>
          <ArrowRight className="mt-auto size-4 text-ink transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
        </Link>
        <Link to="/portal/help" className={tile}>
          <Search className="mb-6 size-7 stroke-[1.25] text-ink" aria-hidden />
          <p className="text-[20px] text-ink">Knowledge base</p>
          <p className="mt-1 mb-6 text-[14px] text-ink-secondary">Answers to common questions.</p>
          <ArrowRight className="mt-auto size-4 text-ink transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
        </Link>
      </div>

      <section aria-labelledby="open-requests-heading">
        <div className="flex items-end justify-between gap-4 border-b border-line pb-4">
          <h2 id="open-requests-heading" className="display text-[28px] sm:text-[32px]">Your open requests</h2>
          <Link to="/portal/requests" className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.14em] text-ink uppercase underline-offset-[6px] hover:underline">
            See all
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
        {isLoading ? (
          <Skeleton className="mt-4 h-24" />
        ) : !open || open.items.length === 0 ? (
          <p className="py-8 text-[15px] text-ink-secondary">Nothing open. Raise a request whenever you need help.</p>
        ) : (
          <ul className="divide-y divide-line border-b border-line">
            {open.items.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link
                  to={`/portal/requests/${t.id}`}
                  className="flex flex-wrap items-center gap-x-6 gap-y-1 px-1 py-5 transition-colors hover:bg-surface-hover sm:flex-nowrap"
                >
                  <span className="w-28 shrink-0 text-[13px] tracking-wide text-ink-secondary tabular-nums">{t.ref}</span>
                  <span className="min-w-0 flex-1 basis-full truncate text-[16px] text-ink sm:basis-auto">{t.title}</span>
                  <StatusPill status={t.status} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
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
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
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
