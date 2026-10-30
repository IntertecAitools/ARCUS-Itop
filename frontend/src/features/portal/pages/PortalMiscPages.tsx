import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Search } from 'lucide-react';
import { Button, buttonClasses, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/data-display';
import { Eyebrow, PageIntro, SectionTitle } from '@/components/public';
import { ChangePasswordDialog } from '@/features/auth';
import { useSessionStore } from '@/stores/session.store';
import { compactNumber } from '@/lib/utils';
import { useFaq, useFaqs, useMyRequests, useProfile, useUpdateProfile } from '../api/portal.api';
import { usePendingApprovalCount } from '@/features/approvals';

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Where an end user lands: their open requests and the ways to get help. */
export function PortalHomePage() {
  const { t } = useTranslation();
  const user = useSessionStore((s) => s.user);
  const { data: open, isLoading } = useMyRequests('open', 1, '');
  const { data: pendingApprovals = 0 } = usePendingApprovalCount();
  const tile = 'lift glass group flex flex-col rounded-card border border-line bg-surface p-6';

  return (
    <>
      <Eyebrow>{t('portal.home.eyebrow')}</Eyebrow>
      <h1 className="display mt-4 text-[40px] sm:text-[56px]">{user?.name ? t('portal.home.helloName', { name: user.name.split(' ')[0] }) : t('portal.home.hello')}</h1>
      <p className="mt-3 mb-12 text-[17px] text-ink-secondary">{t('portal.home.lead')}</p>

      {pendingApprovals > 0 ? (
        <Link
          to="/portal/approvals"
          className="mb-12 flex items-center justify-between gap-4 rounded-card border border-warning/40 bg-warning-soft px-5 py-4 text-warning-ink transition-colors hover:border-warning"
        >
          <span className="text-[16px]">
            {pendingApprovals === 1 ? t('portal.home.approvalOne') : t('portal.home.approvalMany', { count: pendingApprovals })}
          </span>
          <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : null}

      <div className="mb-16 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link to="/portal/new" className={tile}>
          <span className="mb-6 inline-flex size-11 items-center justify-center rounded-xl border border-brand/30 bg-brand-soft text-brand-ink">
            <Plus className="size-5" aria-hidden />
          </span>
          <p className="text-[20px] text-ink">{t('portal.home.raise')}</p>
          <p className="mt-1 mb-6 text-[14px] text-ink-secondary">{t('portal.home.raiseLead')}</p>
          <ArrowRight className="mt-auto size-4 text-ink transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
        </Link>
        <Link to="/portal/requests" className={tile}>
          <p className="display mb-4 h-11 text-[44px] leading-none text-ink tabular-nums">{isLoading ? '…' : compactNumber(open?.total ?? 0)}</p>
          <p className="text-[20px] text-ink">{t('portal.home.open')}</p>
          <p className="mt-1 mb-6 text-[14px] text-ink-secondary">{t('portal.home.openLead')}</p>
          <ArrowRight className="mt-auto size-4 text-ink transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
        </Link>
        <Link to="/portal/help" className={tile}>
          <span className="mb-6 inline-flex size-11 items-center justify-center rounded-xl border border-brand/30 bg-brand-soft text-brand-ink">
            <Search className="size-5" aria-hidden />
          </span>
          <p className="text-[20px] text-ink">{t('portal.home.kb')}</p>
          <p className="mt-1 mb-6 text-[14px] text-ink-secondary">{t('portal.home.kbLead')}</p>
          <ArrowRight className="mt-auto size-4 text-ink transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
        </Link>
      </div>

      <section aria-labelledby="open-requests-heading">
        <div className="flex items-end justify-between gap-4 border-b border-line pb-4">
          <h2 id="open-requests-heading" className="display text-[28px] sm:text-[32px]">{t('portal.home.yourOpen')}</h2>
          <Link to="/portal/requests" className="inline-flex shrink-0 items-center gap-2 text-[13px] font-semibold whitespace-nowrap tracking-[0.14em] text-ink uppercase underline-offset-[6px] hover:underline">
            {t('portal.home.seeAll')}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
        {isLoading ? (
          <Skeleton className="mt-4 h-24" />
        ) : !open || open.items.length === 0 ? (
          <p className="py-8 text-[15px] text-ink-secondary">{t('portal.home.nothingOpen')}</p>
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
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const { data, isLoading } = useFaqs(q.trim());
  const byCategory = new Map<string, NonNullable<typeof data>>();
  const general = t('portal.faqs.general');
  for (const f of data ?? []) byCategory.set(f.category || general, [...(byCategory.get(f.category || general) ?? []), f]);

  return (
    <>
      <PageIntro title={t('portal.nav.help')} intro={t('portal.faqs.intro')} />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('portal.faqs.searchPlaceholder')}
        aria-label={t('portal.faqs.searchLabel')}
        leadingIcon={<Search className="size-4" />}
        className="mb-12 h-12 w-full sm:max-w-xl"
      />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : byCategory.size === 0 ? (
        <p className="text-[15px] text-ink-secondary">{q ? t('portal.faqs.noMatch') : t('portal.faqs.none')}</p>
      ) : (
        <div className="space-y-14">
          {[...byCategory.entries()].map(([category, items]) => (
            <section key={category}>
              <SectionTitle>{category}</SectionTitle>
              <ul className="divide-y divide-line">
                {items.map((f) => (
                  <li key={f.id} className="py-4">
                    <Link to={`/portal/help/${f.id}`} className="text-[17px] text-ink underline-offset-4 hover:underline">{f.title}</Link>
                    {f.summary ? <p className="mt-1 max-w-3xl text-[14px] leading-6 text-ink-secondary">{stripHtml(f.summary)}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export function PortalFaqPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { data: faq, isLoading, error } = useFaq(id);
  return (
    <>
      <Link to="/portal/help" className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-ink-secondary hover:text-ink">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        {t('portal.nav.help')}
      </Link>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !faq ? (
        <p role="alert" className="text-[13px] text-critical-ink">{error instanceof Error ? error.message : t('portal.faqs.notFound')}</p>
      ) : (
        <article className="max-w-3xl">
          <PageIntro eyebrow={faq.category || t('portal.nav.help')} title={faq.title} className="mb-8" />
          {faq.summary ? <p className="mb-6 text-[19px] leading-8 text-ink">{stripHtml(faq.summary)}</p> : null}
          <p className="text-[16px] leading-8 whitespace-pre-wrap text-ink-secondary">{stripHtml(faq.description ?? '') || '—'}</p>
        </article>
      )}
    </>
  );
}

/** The user's own details; phone numbers are theirs to keep current. */
export function PortalProfilePage() {
  const { t } = useTranslation();
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
      <PageIntro title={t('portal.nav.profile')} />
      <Card className="mb-6 max-w-3xl">
        <CardHeader title={`${profile.firstName} ${profile.lastName}`.trim()} subtitle={[profile.function, profile.organization].filter(Boolean).join(' · ')} />
        <CardBody className="space-y-5">
          <p className="text-[15px] text-ink">{profile.email || t('portal.profile.noEmail')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="mb-1.5 block text-[13px] font-medium text-ink">{t('portal.profile.phone')}</label>
              <Input id="phone" className="h-11" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label htmlFor="mobile" className="mb-1.5 block text-[13px] font-medium text-ink">{t('portal.profile.mobile')}</label>
              <Input id="mobile" className="h-11" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
          </div>
          {update.isError ? <p role="alert" className="text-[12px] text-critical-ink">{(update.error as Error).message}</p> : null}
          {update.isSuccess ? <p role="status" className="text-[12px] text-good-ink">{t('portal.profile.saved')}</p> : null}
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'h-11 px-5' })} onClick={() => setChangingPassword(true)}>
              {t('shell.changePassword')}
            </button>
            <Button size="lg" className="h-11 px-6" loading={update.isPending} onClick={() => update.mutate({ phone, mobilePhone: mobile })}>
              {t('common.save')}
            </Button>
          </div>
        </CardBody>
      </Card>
      <p className="text-[13px] text-ink-secondary">{t('portal.profile.other')}</p>
      {changingPassword ? <ChangePasswordDialog onClose={() => setChangingPassword(false)} /> : null}
    </>
  );
}
