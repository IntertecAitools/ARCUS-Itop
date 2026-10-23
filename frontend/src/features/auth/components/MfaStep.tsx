import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
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
  return (
    <p className="mt-6 text-[14px]">
      <button type="button" onClick={onRestart} className="text-ink-secondary underline underline-offset-4 hover:text-ink">
        Start again
      </button>
    </p>
  );
}

function Verify({ onDone, onRestart }: { onDone: () => void; onRestart: () => void }) {
  const verify = useVerifyMfa();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!useRecovery && !CODE.test(value)) return setFormError('Enter the 6-digit code from your authenticator app.');
    if (useRecovery && value.length < 10) return setFormError('Enter one of your recovery codes, e.g. abcde-fghij.');
    setFormError(null);
    verify.mutate(useRecovery ? { recoveryCode: value } : { code: value }, {
      onSuccess: onDone,
      onError: () => setCode(''),
    });
  };

  const error = formError ?? (verify.error instanceof Error ? verify.error.message : null);

  return (
    <AuthCard
      label="Verify it's you"
      intro={
        useRecovery
          ? 'Enter one of the recovery codes you saved when you set up your authenticator. Each works once.'
          : 'Enter the 6-digit code your authenticator app shows for this account.'
      }
      error={error}
      onSubmit={submit}
    >
      <label htmlFor="mfa-code" className="mb-1.5 block text-[13px] font-medium text-ink">
        {useRecovery ? 'Recovery code' : 'Code'}
      </label>
      {useRecovery ? (
        <Input id="mfa-code" autoFocus autoComplete="off" className="h-11 font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
      ) : (
        <CodeInput id="mfa-code" value={code} onChange={setCode} />
      )}

      {endsSignIn(verify.error) ? (
        <Button type="button" className="mt-8 h-12 w-full text-[14px]" onClick={onRestart}>
          Sign in again
        </Button>
      ) : (
        <Button type="submit" className="mt-8 h-12 w-full text-[14px]" loading={verify.isPending}>
          Verify
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
          {useRecovery ? 'Use my authenticator app' : 'Lost your phone? Use a recovery code'}
        </button>
      </p>
      <RestartLink onRestart={onRestart} />
    </AuthCard>
  );
}

function Enrol({ onDone, onRestart }: { onDone: () => void; onRestart: () => void }) {
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
        label="Save your recovery codes"
        intro="If you lose your phone, each of these signs you in once instead of a code. Keep them somewhere safe: they are not shown again."
        onSubmit={(e) => {
          e.preventDefault();
          confirm.finish();
          onDone();
        }}
      >
        <ul className="grid grid-cols-2 gap-2 rounded-card border border-line bg-surface-sunken p-4 font-mono text-[14px]" aria-label="Recovery codes">
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
          {copied ? 'Copied' : 'Copy the codes'}
        </Button>
        <Button type="submit" className="mt-6 h-12 w-full text-[14px]">
          I've saved them, continue
        </Button>
      </AuthCard>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!CODE.test(code)) return setFormError('Enter the 6-digit code your authenticator app shows.');
    setFormError(null);
    confirm.mutate(code, { onError: () => setCode('') });
  };

  const loadError = enrolment.error instanceof Error ? enrolment.error.message : null;
  const error = formError ?? loadError ?? (confirm.error instanceof Error ? confirm.error.message : null);

  return (
    <AuthCard
      label="Set up your authenticator"
      intro="Your account needs a second step at sign-in. Scan this with an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password...), then enter the code it shows."
      error={error}
      onSubmit={submit}
    >
      {enrolment.data ? (
        <div className="mb-6 flex flex-col items-center gap-3">
          {qr ? (
            <img src={qr} alt="QR code for your authenticator app" width={192} height={192} className="rounded-card bg-white p-2" />
          ) : null}
          <p className="text-center text-[13px] text-ink-secondary">
            Can't scan it? Enter this key in the app, for {enrolment.data.account}:
            <span className="mt-1 block font-mono text-[14px] text-ink select-all">{grouped(enrolment.data.secret)}</span>
          </p>
        </div>
      ) : null}

      <label htmlFor="mfa-code" className="mb-1.5 block text-[13px] font-medium text-ink">
        Code from the app
      </label>
      <CodeInput id="mfa-code" value={code} onChange={setCode} />

      {endsSignIn(confirm.error) || (enrolment.error instanceof ApiError && enrolment.error.status === 401) ? (
        <Button type="button" className="mt-8 h-12 w-full text-[14px]" onClick={onRestart}>
          Sign in again
        </Button>
      ) : (
        <Button type="submit" className="mt-8 h-12 w-full text-[14px]" loading={confirm.isPending} disabled={!enrolment.data}>
          Confirm
        </Button>
      )}
      <RestartLink onRestart={onRestart} />
    </AuthCard>
  );
}
