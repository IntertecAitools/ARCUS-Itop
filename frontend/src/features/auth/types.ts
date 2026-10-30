// auth: feature types.

/**
 * The signed-in user, as the BFF's `/auth/me` describes them. Mirrors
 * `PublicUser` in backend/src/platform/auth/auth.service.ts. It never carries
 * credentials: those stay in the BFF.
 */
export interface SessionUser {
  id: number;
  login: string;
  name: string;
  email: string;
  /** `staff` use these screens; `portal` are end users. */
  kind: 'staff' | 'portal';
  profiles: string[];
  isAdmin: boolean;
  contactId: number;
  orgId: number;
  /** The interface language the user chose; null until they choose one. */
  language?: 'en' | 'ar' | null;
}

/** Where a sign-in waiting for its second factor is. */
export type MfaStep = 'verify' | 'enrol';

/** `POST /auth/login`: signed in, or an authenticator code is needed first. */
export type SignInResult = { user: SessionUser } | { mfa: { step: MfaStep } };

/** What the sign-in page may offer before anyone is signed in. */
export interface AuthOptions {
  passwordReset: boolean;
  /** Single sign-on (e.g. Microsoft Entra ID), with its button text; null when off. */
  sso: { label: string } | null;
  /** Who may use a password: everyone, end users (staff use SSO), or break-glass accounts only. */
  passwordSignIn: 'all' | 'portal' | 'break-glass';
  /** End users at a claimed email domain may create their own account. */
  selfRegistration?: boolean;
}

/** A new authenticator to set up: the key, and the otpauth:// link a QR code carries. */
export interface MfaEnrolment {
  secret: string;
  otpauthUrl: string;
  account: string;
}
