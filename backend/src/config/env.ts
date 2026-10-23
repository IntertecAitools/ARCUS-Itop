import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ITOP_TIMEZONE } from "../shared/itop-time.js";

/**
 * Relative paths in .env resolve against the package root (the directory
 * holding package.json), which is two levels up from `src/config/`.
 */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Minimal .env loader. Deliberately dependency-free: the only consumer is this
 * file, and dotenv's extra features (expansion, multiline) are not used here.
 * Real environment variables always win over the file.
 */
function loadDotEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // absent .env is fine -- the environment may supply everything
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key === "" || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}".`);
  }
  return parsed;
}

/** REST dialects this iTop build accepts (CoreServices::ListOperations). */
export const SUPPORTED_REST_VERSIONS = ["1.0", "1.1", "1.2", "1.3", "1.4"] as const;

export interface Config {
  itop: {
    /** Fully-qualified rest.php endpoint. */
    endpoint: string;
    baseUrl: string;
    user: string;
    password: string;
    version: string;
    timeoutMs: number;
    retries: number;
    defaultComment: string;
    /**
     * iTop's `timezone` (config-itop.php). iTop writes datetimes as wall-clock
     * text in it, with no offset; this is how they become exact instants.
     */
    timezone: string;
    /**
     * The request header iTop's "external" login reads (ext_auth_variable),
     * e.g. X-Arcus-Remote-User. Staff who signed in with single sign-on have
     * no iTop password, so their calls carry their login in it instead. Unset:
     * staff cannot use single sign-on.
     */
    externalAuthHeader?: string;
  };
  server: {
    host: string;
    port: number;
    logLevel: string;
    /**
     * Read the client address from X-Forwarded-For. On only behind a reverse
     * proxy you control, or a client could pick its own address. `true`
     * trusts every hop (the left-most address wins), a number trusts that
     * many hops in front of the BFF, a list trusts those proxy addresses or
     * CIDR ranges. Fastify's `trustProxy`, as is.
     */
    trustProxy: boolean | number | string[];
  };
  corsOrigins: string[] | "*";
  schemaPath: string;
  /** iTop's navigation tree, from cmdb-schema/extract-navigation.py. */
  navigationPath: string;
  /** iTop's dashboard definitions, from cmdb-schema/extract-dashboards.py. */
  dashboardsPath: string;
  lookupCacheTtlMs: number;
  /**
   * The frontend's public address, e.g. https://helpdesk.example.com. Links
   * in emails (password resets, notifications) point here, never at iTop.
   */
  appBaseUrl?: string;
  /**
   * Sender of iTop's notification emails, from NOTIFICATION_FROM or else
   * MAIL_FROM ("Label <address>" or a bare address). Absent when neither is set.
   */
  notificationSender?: { address: string; label: string };
  /** Pins the organisation new records belong to. Optional. */
  defaultOrgId?: string;
  auth: {
    /**
     * When true (the default) every /api route except sign-in needs a session,
     * and iTop calls for staff are made with the signed-in user's own account.
     * Off only for tests and local experiments.
     */
    required: boolean;
    /** Idle time after which a session ends. */
    sessionIdleMs: number;
    /** Longest a session may live, active or not. */
    sessionMaxMs: number;
    /** Send the session cookie with `Secure`; must be on behind HTTPS. */
    cookieSecure: boolean;
    /**
     * Where sessions live. `memory` (the default) loses them on restart and
     * allows one BFF instance; `mysql` keeps them, encrypted, in a table every
     * instance shares.
     */
    sessionStore: SessionStoreConfig;
    /** "Forgot password" by email; absent when no SMTP server is configured. */
    passwordReset?: PasswordResetConfig;
    /**
     * SESSION_SECRET, when set: seals authenticator secrets and the single
     * sign-on state cookie. Without it a random key per process is used.
     */
    secret?: string;
    /** MFA, single sign-on and break-glass rules. Absent: password only, no MFA. */
    signIn?: SignInPolicy;
  };
}

export interface SignInPolicy {
  /**
   * Who must give an authenticator code after a password sign-in: `staff`
   * (agents and administrators), `admin` (administrators only) or `off`.
   * Break-glass accounts always must. An account that has enrolled is always asked.
   */
  mfaRequired: "staff" | "admin" | "off";
  /** The name authenticator apps show next to the code. */
  totpIssuer: string;
  /**
   * Who may sign in with a password: `all`, `portal` (end users and
   * break-glass accounts; staff use single sign-on) or `break-glass` (only
   * break-glass accounts; everyone else uses single sign-on).
   */
  passwordSignIn: "all" | "portal" | "break-glass";
  /** iTop logins of the break-glass accounts, lower case. */
  breakGlassLogins: string[];
  sso?: SsoConfig;
}

/** OpenID Connect single sign-on (Authorization Code + PKCE), e.g. Microsoft Entra ID. */
export interface SsoConfig {
  /** e.g. https://login.microsoftonline.com/<tenant-id>/v2.0 */
  issuer: string;
  clientId: string;
  /** Absent for a public client (PKCE only). */
  clientSecret?: string;
  /** The BFF's callback, as registered at the IdP: <public address>/api/auth/sso/callback */
  redirectUri: string;
  scopes: string;
  /** Claims tried in order for the user's email address. */
  emailClaims: string[];
  /** The button text, e.g. "Sign in with Microsoft". */
  label: string;
  /**
   * For staff signing in this way: `idp-or-totp` trusts the IdP's `amr` claim
   * when it shows MFA and otherwise asks for our authenticator code; `idp`
   * refuses sign-in unless `amr` shows MFA; `off` asks for nothing (the IdP
   * enforces MFA by its own policy).
   */
  mfa: "idp-or-totp" | "idp" | "off";
  /** `amr` values that count as MFA (RFC 8176). */
  mfaAmr: string[];
  /** Where the browser goes after signing in (the frontend); errors add ?sso_error=. */
  appUrl: string;
  /** Allow an http:// issuer: only for a local test IdP. */
  allowHttp: boolean;
}

export interface PasswordResetConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    /** Refuse to send unless the connection is encrypted. Off only for a local test mailbox. */
    requireTls: boolean;
    user?: string;
    password?: string;
  };
  /** The From address on reset emails. */
  from: string;
  /** The frontend's public address; reset links point at `<appBaseUrl>/reset-password`. */
  appBaseUrl: string;
  /** How long a reset link works. */
  tokenTtlMs: number;
}

/** TRUST_PROXY: true/false, a hop count, or a comma-separated list of addresses / CIDRs. */
export function trustProxy(raw: string): boolean | number | string[] {
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > 10) throw new Error(`TRUST_PROXY as a hop count must be 1 to 10, got "${raw}".`);
    return hops;
  }
  const list = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (!list.every((part) => /^[0-9a-f.:]+(\/\d{1,3})?$/.test(part))) {
    throw new Error(`TRUST_PROXY must be true, false, a hop count or a list of addresses/CIDRs, got "${raw}".`);
  }
  return list;
}

function itopTimezone(): string {
  const zone = optional("ITOP_TIMEZONE", DEFAULT_ITOP_TIMEZONE);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new Error(`ITOP_TIMEZONE "${zone}" is not a time zone (e.g. Europe/Paris, Asia/Kolkata).`);
  }
  return zone;
}

function appBaseUrl(): string | undefined {
  const value = optional("APP_BASE_URL", "").replace(/\/+$/, "");
  if (!value) return undefined;
  if (!/^https?:\/\//.test(value)) {
    throw new Error("APP_BASE_URL must start with http:// or https://.");
  }
  return value;
}

/** "Intertec Helpdesk <helpdesk@x.com>" or "helpdesk@x.com" to address and label. */
export function parseMailbox(value: string): { address: string; label: string } | undefined {
  const named = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  const address = (named?.[2] ?? value).trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return undefined;
  return { address, label: named ? named[1]!.trim() : "" };
}

function notificationSender(): { address: string; label: string } | undefined {
  const raw = optional("NOTIFICATION_FROM", "") || optional("MAIL_FROM", "");
  if (!raw) return undefined;
  const parsed = parseMailbox(raw);
  if (!parsed) throw new Error(`NOTIFICATION_FROM / MAIL_FROM is not an email address: "${raw}".`);
  return parsed;
}

function withPasswordReset(config: PasswordResetConfig | undefined) {
  return config ? { passwordReset: config } : {};
}

function passwordResetConfig(): PasswordResetConfig | undefined {
  const host = optional("SMTP_HOST", "");
  if (!host) return undefined;
  const user = optional("SMTP_USER", "");
  const password = optional("SMTP_PASSWORD", "");
  const base = appBaseUrl();
  if (!base) throw new Error("APP_BASE_URL is required when SMTP_HOST is set: reset links point at it.");
  const port = integer("SMTP_PORT", 587, 1, 65_535);
  return {
    smtp: {
      host,
      port,
      // 465 is implicit TLS; 587 and 25 upgrade with STARTTLS.
      secure: optional("SMTP_SECURE", port === 465 ? "true" : "false").toLowerCase() === "true",
      requireTls: optional("SMTP_REQUIRE_TLS", "true").toLowerCase() !== "false",
      ...(user ? { user } : {}),
      ...(password ? { password } : {}),
    },
    from: required("MAIL_FROM"),
    appBaseUrl: base,
    tokenTtlMs: integer("PASSWORD_RESET_MINUTES", 30, 5, 24 * 60) * 60_000,
  };
}

export type SessionStoreConfig =
  | { kind: "memory" }
  | {
      kind: "mysql";
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      /** Encrypts what a session holds (it carries the user's iTop password). */
      secret: string;
    };

function oneOf<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const value = optional(name, fallback).toLowerCase() as T;
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}, not "${value}".`);
  }
  return value;
}

const list = (raw: string) => raw.split(",").map((part) => part.trim()).filter(Boolean);

function ssoConfig(): SsoConfig | undefined {
  const issuer = optional("OIDC_ISSUER", "").replace(/\/+$/, "");
  if (!issuer) return undefined;
  const allowHttp = optional("OIDC_ALLOW_HTTP", "false").toLowerCase() === "true";
  if (!/^https:\/\//.test(issuer) && !(allowHttp && /^http:\/\//.test(issuer))) {
    throw new Error("OIDC_ISSUER must start with https:// (OIDC_ALLOW_HTTP=true allows http:// for a local test IdP).");
  }
  const redirectUri = required("OIDC_REDIRECT_URI");
  if (!/^https?:\/\/[^/]+(\/.*)?\/api\/auth\/sso\/callback$/.test(redirectUri)) {
    throw new Error("OIDC_REDIRECT_URI must be the BFF's callback: <public address>/api/auth/sso/callback.");
  }
  const appUrl = optional("OIDC_APP_URL", appBaseUrl() ?? "/").replace(/\/+$/, "") || "/";
  const secret = optional("OIDC_CLIENT_SECRET", "");
  return {
    issuer,
    clientId: required("OIDC_CLIENT_ID"),
    ...(secret ? { clientSecret: secret } : {}),
    redirectUri,
    scopes: optional("OIDC_SCOPES", "openid profile email"),
    emailClaims: list(optional("OIDC_EMAIL_CLAIMS", "email,preferred_username,upn")),
    label: optional("OIDC_LABEL", "Sign in with Microsoft"),
    mfa: oneOf("SSO_MFA", "idp-or-totp", ["idp-or-totp", "idp", "off"] as const),
    mfaAmr: list(optional("OIDC_MFA_AMR", "mfa,otp,hwk,sms,fido")).map((v) => v.toLowerCase()),
    appUrl,
    allowHttp,
  };
}

function signInPolicy(): SignInPolicy {
  const sso = ssoConfig();
  const passwordSignIn = oneOf("PASSWORD_SIGN_IN", "all", ["all", "portal", "break-glass"] as const);
  if (passwordSignIn !== "all" && !sso) {
    throw new Error(`PASSWORD_SIGN_IN=${passwordSignIn} needs single sign-on (OIDC_ISSUER): staff would have no way in.`);
  }
  return {
    mfaRequired: oneOf("MFA_REQUIRED", "staff", ["staff", "admin", "off"] as const),
    totpIssuer: optional("MFA_ISSUER", "Arcus Helpdesk"),
    passwordSignIn,
    breakGlassLogins: list(optional("BREAK_GLASS_LOGINS", "")).map((l) => l.toLowerCase()),
    ...(sso ? { sso } : {}),
  };
}

function sessionStoreConfig(): SessionStoreConfig {
  const kind = optional("SESSION_STORE", "memory").toLowerCase();
  if (kind === "memory") return { kind: "memory" };
  if (kind !== "mysql") {
    throw new Error(`SESSION_STORE must be "memory" or "mysql", not "${kind}".`);
  }
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters; generate one with `openssl rand -base64 48`.");
  }
  return {
    kind: "mysql",
    host: optional("SESSION_DB_HOST", "127.0.0.1"),
    port: integer("SESSION_DB_PORT", 3306, 1, 65_535),
    user: required("SESSION_DB_USER"),
    password: optional("SESSION_DB_PASSWORD", ""),
    database: optional("SESSION_DB_NAME", "arcus_bff"),
    secret,
  };
}

export function loadConfig(envFile = resolve(PACKAGE_ROOT, ".env")): Config {
  loadDotEnv(envFile);

  const baseUrl = optional("ITOP_BASE_URL", "http://localhost:8080").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`ITOP_BASE_URL must start with http:// or https://, got "${baseUrl}".`);
  }

  const version = optional("ITOP_REST_VERSION", "1.4");
  if (!(SUPPORTED_REST_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(
      `ITOP_REST_VERSION "${version}" is not supported by iTop 3.4. ` +
        `Use one of: ${SUPPORTED_REST_VERSIONS.join(", ")}.`,
    );
  }

  const corsRaw = optional("CORS_ORIGINS", "*");
  const corsOrigins: string[] | "*" =
    corsRaw === "*"
      ? "*"
      : corsRaw
          .split(",")
          .map((o) => o.trim().replace(/\/+$/, ""))
          .filter((o) => o !== "");

  return {
    itop: {
      baseUrl,
      endpoint: `${baseUrl}/webservices/rest.php`,
      user: required("ITOP_USER"),
      password: required("ITOP_PASSWORD"),
      version,
      timeoutMs: integer("ITOP_TIMEOUT_MS", 30_000, 1_000, 600_000),
      retries: integer("ITOP_RETRIES", 2, 0, 10),
      // Lands in iTop's change log on every write, so it is read by humans
      // auditing history inside iTop itself.
      defaultComment: optional("ITOP_DEFAULT_COMMENT", "via intertec-backend"),
      timezone: itopTimezone(),
      ...(optional("ITOP_EXTERNAL_AUTH_HEADER", "")
        ? { externalAuthHeader: optional("ITOP_EXTERNAL_AUTH_HEADER", "") }
        : {}),
    },
    server: {
      host: optional("HOST", "127.0.0.1"),
      // 0 is allowed and means "let the OS pick a free port", which containers
      // and test harnesses rely on.
      port: integer("PORT", 4000, 0, 65_535),
      logLevel: optional("LOG_LEVEL", "info"),
      trustProxy: trustProxy(optional("TRUST_PROXY", "false")),
    },
    corsOrigins,
    schemaPath: resolve(
      PACKAGE_ROOT,
      optional("CMDB_SCHEMA_PATH", "../cmdb-schema/cmdb-schema.json"),
    ),
    navigationPath: resolve(
      PACKAGE_ROOT,
      optional("CMDB_NAVIGATION_PATH", "../cmdb-schema/cmdb-navigation.json"),
    ),
    dashboardsPath: resolve(
      PACKAGE_ROOT,
      optional("CMDB_DASHBOARDS_PATH", "../cmdb-schema/cmdb-dashboards.json"),
    ),
    lookupCacheTtlMs: integer("LOOKUP_CACHE_TTL", 60, 0, 86_400) * 1000,
    ...(appBaseUrl() ? { appBaseUrl: appBaseUrl()! } : {}),
    ...(notificationSender() ? { notificationSender: notificationSender()! } : {}),
    ...(optional("ITOP_DEFAULT_ORG_ID", "") ? { defaultOrgId: optional("ITOP_DEFAULT_ORG_ID", "") } : {}),
    auth: {
      required: optional("AUTH_REQUIRED", "true").toLowerCase() !== "false",
      sessionIdleMs: integer("SESSION_IDLE_MINUTES", 60, 5, 24 * 60) * 60_000,
      sessionMaxMs: integer("SESSION_MAX_HOURS", 12, 1, 24 * 30) * 3_600_000,
      cookieSecure: optional("COOKIE_SECURE", "false").toLowerCase() === "true",
      sessionStore: sessionStoreConfig(),
      ...withPasswordReset(passwordResetConfig()),
      ...(optional("SESSION_SECRET", "") ? { secret: optional("SESSION_SECRET", "") } : {}),
      signIn: signInPolicy(),
    },
  };
}
