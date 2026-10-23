import type { SignInPolicy } from "../../config/env.js";
import { badRequest } from "../../core/errors.js";
import type { Caller } from "../../core/request-context.js";
import type { MfaStore } from "./mfa.store.js";
import {
  hashRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUrl,
  verifyTotp,
} from "./totp.js";

export interface MfaStatus {
  enrolled: boolean;
  enrolledAt?: number;
  recoveryCodesLeft: number;
}

/**
 * Authenticator (TOTP) codes and recovery codes for the BFF's own sign-in.
 *
 * Asked after a password sign-in from staff (MFA_REQUIRED), from every
 * break-glass account, from anyone who has enrolled, and after single sign-on
 * when the IdP did not report MFA itself (SSO_MFA=idp-or-totp).
 */
export class MfaService {
  constructor(
    private readonly store: MfaStore,
    private readonly policy: SignInPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Whether a password sign-in must give a code, enrolled or not. (An
   * account that has enrolled is asked whatever this says.)
   */
  requiredFor(caller: Caller): boolean {
    if (caller.signIn?.method === "break-glass") return true;
    if (caller.kind !== "staff") return false;
    if (this.policy.mfaRequired === "staff") return true;
    return this.policy.mfaRequired === "admin" && caller.isAdmin;
  }

  ready(): Promise<void> {
    return this.store.ready();
  }

  async status(userId: number): Promise<MfaStatus> {
    const enrolment = await this.store.get(userId);
    if (!enrolment) return { enrolled: false, recoveryCodesLeft: 0 };
    return {
      enrolled: true,
      enrolledAt: enrolment.enrolledAt,
      recoveryCodesLeft: await this.store.recoveryCodesLeft(userId),
    };
  }

  /** A secret to enrol: kept in the pending sign-in until a code confirms it. */
  newSecret(): string {
    return newTotpSecret();
  }

  /** The link an authenticator app scans (as a QR code) or opens. */
  otpauthUrl(caller: Caller, secret: string): string {
    return otpauthUrl(secret, this.policy.totpIssuer, caller.email || caller.login);
  }

  /**
   * Saves the enrolment once a code from the app proves it was set up, and
   * returns the recovery codes: shown this once, kept only as hashes.
   */
  async confirmEnrolment(caller: Caller, secret: string, code: string): Promise<string[] | undefined> {
    const step = verifyTotp(secret, code, this.now());
    if (step === undefined) return undefined;
    const codes = newRecoveryCodes();
    await this.store.put(
      { userId: caller.userId, login: caller.login, secret, enrolledAt: this.now() },
      codes.map(hashRecoveryCode),
    );
    await this.store.useStep(caller.userId, step);
    return codes;
  }

  /**
   * Checks an authenticator code, or a recovery code (which is then used up).
   * Undefined when it is neither.
   */
  async verify(caller: Caller, input: { code?: string; recoveryCode?: string }): Promise<"totp" | "recovery" | undefined> {
    const enrolment = await this.store.get(caller.userId);
    if (!enrolment) return undefined;
    if (input.code) {
      // useStep refuses a step at or before the last one used: the atomic
      // check that also settles a race between two instances.
      const step = verifyTotp(enrolment.secret, input.code, this.now());
      if (step !== undefined && (await this.store.useStep(caller.userId, step))) return "totp";
      return undefined;
    }
    if (input.recoveryCode) {
      return (await this.store.useRecoveryCode(caller.userId, hashRecoveryCode(input.recoveryCode)))
        ? "recovery"
        : undefined;
    }
    throw badRequest("Enter the code from your authenticator app, or a recovery code.");
  }

  /** New recovery codes, replacing the old ones; needs a current authenticator code. */
  async renewRecoveryCodes(caller: Caller, code: string): Promise<string[] | undefined> {
    if ((await this.verify(caller, { code })) !== "totp") return undefined;
    const codes = newRecoveryCodes();
    await this.store.replaceRecoveryCodes(caller.userId, codes.map(hashRecoveryCode));
    return codes;
  }

  /** Removes an enrolment (lost phone): the account enrols again at its next sign-in. */
  async reset(userId: number): Promise<boolean> {
    const had = (await this.store.get(userId)) !== undefined;
    await this.store.delete(userId);
    return had;
  }
}
