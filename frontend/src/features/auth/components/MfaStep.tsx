import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { useConfirmMfaEnrolment, useMfaEnrolment, useVerifyMfa } from '../hooks/useSession';
import type { MfaStep as Step } from '../types';
import { AuthCard } from './AuthCard';

const CODE = /^\d{6}$/;

/** The key in groups of four, easier to type into an app by hand. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * The second step of sign-in: an authenticator code, or setting one up.
 *
 * `onDone` runs once the session has started; `onRestart` sends the user
 * back to the first step (this sign-in expired, or too many wrong codes).
 */
export function MfaStep({ step, onDone, onRestart }: { step: Step; onDone: () => void; onRestart: () => void }) {
  return step === 'enrol' ? (
    <Enrol onDone={onDone} onRestart={onRestart} />
  ) : (
    <Verify onDone={onDone} onRestart={onRestart} />
  );
}

/** Whether an error ended this sign-in, rather than just refusing one code. */
function endsSignIn(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  return (error.details as { attemptsLeft?: number } | undefined)?.attemptsLeft === undefined;
}

function CodeInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      maxLength={6}
      className="h-11 font-mono tracking-[0.3em]"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}

function RestartLink({ onRestart }: { onRestart: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="mt-6 text-[14px]">
      <button type="button" onClick={onRestart} className="text-ink-secondary underline underline-offset-4 hover:text-ink">
        {t('auth.mfa.startAgain')}
      </button>
    </p>
  );
}

function Verify({ onDone, onRestart }: { onDone: () => void; onRestart: () => void }) {
  const { t } = useTranslation();
  const verify = useVerifyMfa();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!useRecovery && !CODE.test(value)) return setFormError(t('auth.mfa.enterCode'));
    if (useRecovery && value.length < 10) return setFormError(t('auth.mfa.enterRecovery'));
    setFormError(null);
    verify.mutate(useRecovery ? { recoveryCode: value } : { code: value }, {
      onSuccess: onDone,
      onError: () => setCode(''),
    });
  };

  const error = formError ?? (verify.error instanceof Error ? verify.error.message : null);

  return (
    <AuthCard
      label={t('auth.mfa.verifyTitle')}
      intro={useRecovery ? t('auth.mfa.recoveryIntro') : t('auth.mfa.verifyIntro')}
      error={error}
      onSubmit={submit}
    >
      <label htmlFor="mfa-code" className="mb-1.5 block text-[13px] font-medium text-ink">
        {useRecovery ? t('auth.mfa.recoveryCode') : t('auth.mfa.code')}
      </label>
      {useRecovery ? (
        <Input id="mfa-code" autoFocus autoComplete="off" className="h-11 font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
      ) : (
        <CodeInput id="mfa-code" value={code} onChange={setCode} />
      )}

      {endsSignIn(verify.error) ? (
        <Button type="button" className="mt-8 h-12 w-full text-[14px]" onClick={onRestart}>
          {t('auth.mfa.signInAgain')}
        </Button>
      ) : (
        <Button type="submit" className="mt-8 h-12 w-full text-[14px]" loading={verify.isPending}>
          {t('auth.mfa.verify')}
        </Button>
      )}

      <p className="mt-6 text-[14px]">
        <button
          type="button"
          onClick={() => {
            setUseRecovery((r) => !r);
            setCode('');
            setFormError(null);
          }}
          className="text-ink-secondary underline underline-offset-4 hover:text-ink"
        >
          {useRecovery ? t('auth.mfa.useApp') : t('auth.mfa.useRecovery')}
        </button>
      </p>
      <RestartLink onRestart={onRestart} />
    </AuthCard>
  );
}

function Enrol({ onDone, onRestart }: { onDone: () => void; onRestart: () => void }) {
  const { t } = useTranslation();
  const enrolment = useMfaEnrolment(true);
  const confirm = useConfirmMfaEnrolment();
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const otpauthUrl = enrolment.data?.otpauthUrl;
  useEffect(() => {
    if (!otpauthUrl) return;
    let live = true;
    QRCode.toDataURL(otpauthUrl, { margin: 1, width: 192 }).then((url) => live && setQr(url), () => setQr(null));
    return () => {
      live = false;
    };
  }, [otpauthUrl]);

  // Set up: the recovery codes, shown this once, before the session starts.
  const codes = confirm.data?.recoveryCodes;
  if (codes) {
    return (
      <AuthCard
        label={t('auth.mfa.saveTitle')}
        intro={t('auth.mfa.saveIntro')}
        onSubmit={(e) => {
          e.preventDefault();
          confirm.finish();
          onDone();
        }}
      >
        <ul className="grid grid-cols-2 gap-2 rounded-card border border-line bg-surface-sunken p-4 font-mono text-[14px]" aria-label={t('auth.mfa.codesLabel')}>
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          className="mt-4 h-10 w-full text-[14px]"
          onClick={() => void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true))}
        >
          {copied ? t('auth.mfa.copied') : t('auth.mfa.copy')}
        </Button>
        <Button type="submit" className="mt-6 h-12 w-full text-[14px]">
          {t('auth.mfa.savedContinue')}
        </Button>
      </AuthCard>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!CODE.test(code)) return setFormError(t('auth.mfa.enrolEnterCode'));
    setFormError(null);
    confirm.mutate(code, { onError: () => setCode('') });
  };

  const loadError = enrolment.error instanceof Error ? enrolment.error.message : null;
  const error = formError ?? loadError ?? (confirm.error instanceof Error ? confirm.error.message : null);

  return (
    <AuthCard
      label={t('auth.mfa.enrolTitle')}
      intro={t('auth.mfa.enrolIntro')}
      error={error}
      onSubmit={submit}
    >
      {enrolment.data ? (
        <div className="mb-6 flex flex-col items-center gap-3">
          {qr ? (
            <img src={qr} alt={t('auth.mfa.qrAlt')} width={192} height={192} className="rounded-card bg-white p-2" />
          ) : null}
          <p className="text-center text-[13px] text-ink-secondary">
            {t('auth.mfa.cantScan', { account: enrolment.data.account })}
            <span className="mt-1 block font-mono text-[14px] text-ink select-all">{grouped(enrolment.data.secret)}</span>
          </p>
        </div>
      ) : null}

      <label htmlFor="mfa-code" className="mb-1.5 block text-[13px] font-medium text-ink">
        {t('auth.mfa.codeFromApp')}
      </label>
      <CodeInput id="mfa-code" value={code} onChange={setCode} />

      {endsSignIn(confirm.error) || (enrolment.error instanceof ApiError && enrolment.error.status === 401) ? (
        <Button type="button" className="mt-8 h-12 w-full text-[14px]" onClick={onRestart}>
          {t('auth.mfa.signInAgain')}
        </Button>
      ) : (
        <Button type="submit" className="mt-8 h-12 w-full text-[14px]" loading={confirm.isPending} disabled={!enrolment.data}>
          {t('auth.mfa.confirm')}
        </Button>
      )}
      <RestartLink onRestart={onRestart} />
    </AuthCard>
  );
}
