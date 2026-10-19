import { createHash, randomBytes } from "node:crypto";

import type { PasswordResetConfig } from "../../config/env.js";
import { AppError, badRequest } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { quoteString } from "../../itop/oql.js";
import { str } from "../../shared/ticket-mapping.js";
import type { AuthService } from "./auth.service.js";
import type { Mailer } from "./mailer.js";
import type { ResetTokenStore } from "./reset-token.store.js";
import type { SessionStore } from "./session.store.js";

/** Requests allowed per window: per client address, and per login/email asked about. */
const PER_ADDRESS = 10;
const PER_IDENTIFIER = 3;
const WINDOW_MS = 15 * 60_000;

/** How many accounts one email address may reset at once (shared mailboxes). */
const MAX_ACCOUNTS_PER_EMAIL = 5;

export const MIN_PASSWORD_LENGTH = 8;

interface Account {
  id: number;
  login: string;
  name: string;
  email: string;
}

/** Counts events per key over a sliding window. In memory: per BFF instance. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an attempt; false when the key is over its limit. */
  allow(key: string): boolean {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(at);
    return true;
  }

  private prune(at: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => at - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/**
 * "Forgot password" by email, for every kind of user, so nobody needs iTop's
 * own reset page.
 *
 * - A request never says whether an account exists: the answer is the same
 *   either way, and the email is sent after the response.
 * - Only enabled local accounts (UserLocal) with an email address qualify; an
 *   LDAP or external account's password lives elsewhere.
 * - A link carries 256 random bits, is stored only as a SHA-256, works once,
 *   expires, and a newer request replaces it.
 * - A reset signs the account out everywhere.
 */
export class PasswordResetService {
  private readonly byAddress: RateLimiter;
  private readonly byIdentifier: RateLimiter;

  constructor(
    private readonly client: ItopClient,
    private readonly auth: AuthService,
    private readonly tokens: ResetTokenStore,
    private readonly sessions: SessionStore,
    private readonly mailer: Mailer | undefined,
    private readonly config: PasswordResetConfig | undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.byAddress = new RateLimiter(PER_ADDRESS, WINDOW_MS, now);
    this.byIdentifier = new RateLimiter(PER_IDENTIFIER, WINDOW_MS, now);
  }

  get enabled(): boolean {
    return Boolean(this.mailer && this.config);
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new AppError("not_found", "Password reset by email is not set up on this platform.");
    }
  }

  /**
   * Checks a request and returns the work to do after answering it. The
   * caller answers first and runs the work afterwards, so how long the answer
   * takes does not reveal whether the account exists.
   */
  request(identifier: string, address: string): () => Promise<void> {
    this.assertEnabled();
    const asked = identifier.trim();
    if (!asked) throw badRequest("Enter your login or email address.");
    if (!this.byAddress.allow(address)) {
      throw new AppError("rate_limited", "Too many requests. Try again in a few minutes.");
    }
    // Over the per-account limit the answer is unchanged; nothing is sent.
    if (!this.byIdentifier.allow(asked.toLowerCase())) return async () => {};
    return () => this.sendLinks(asked);
  }

  private async sendLinks(asked: string): Promise<void> {
    for (const account of await this.findAccounts(asked)) {
      // A new link replaces any earlier one.
      await this.tokens.deleteForUser(account.id);
      const token = randomBytes(32).toString("base64url");
      await this.tokens.put(hashToken(token), account.id, this.now() + this.config!.tokenTtlMs);
      await this.mailer!.send(resetMail(account, token, this.config!));
    }
  }

  /** Sets a new password from a link, and signs the account out everywhere. */
  async reset(token: string, password: string): Promise<void> {
    this.assertEnabled();
    const userId = token ? await this.tokens.peek(hashToken(token)) : undefined;
    if (userId === undefined) {
      throw badRequest("This link has expired or was already used. Ask for a new one.");
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw badRequest(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    // The link stays valid if iTop refuses the password (its own policy), so
    // the user can try another one; it is used up only once one is accepted.
    await this.auth.setLocalPassword(userId, password, "Password reset by email");
    await this.tokens.deleteForUser(userId);
    await this.sessions.deleteForUser(userId);
  }

  /** Enabled local accounts matching a login, or else an email address. */
  private async findAccounts(asked: string): Promise<Account[]> {
    let rows = await this.lookup(`login = ${quoteString(asked)}`, 1);
    if (rows.length === 0 && asked.includes("@")) {
      rows = await this.lookup(`email = ${quoteString(asked)}`, MAX_ACCOUNTS_PER_EMAIL);
    }
    return rows;
  }

  private async lookup(where: string, limit: number): Promise<Account[]> {
    const result = await this.client.call(
      "core/get",
      {
        class: "UserLocal",
        key: `SELECT UserLocal WHERE ${where} AND status = 'enabled'`,
        output_fields: "id,login,first_name,last_name,email",
        limit,
      },
      { asService: true },
    );
    return normalizeObjects(result.objects)
      .map((row) => ({
        id: row.id,
        login: str(row.fields["login"]),
        name: [str(row.fields["first_name"]), str(row.fields["last_name"])].filter(Boolean).join(" "),
        email: str(row.fields["email"]),
      }))
      .filter((account) => account.email.includes("@"));
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function resetMail(account: Account, token: string, config: PasswordResetConfig) {
  // The token rides in the fragment: browsers never send it to a server, so it
  // stays out of access logs and Referer headers.
  const link = `${config.appBaseUrl}/reset-password#token=${token}`;
  const minutes = Math.round(config.tokenTtlMs / 60_000);
  const greeting = account.name ? `Hello ${account.name},` : "Hello,";
  return {
    to: account.email,
    subject: "Reset your password",
    text:
      `${greeting}\n\n` +
      `Someone asked to reset the password of the account "${account.login}". ` +
      `To choose a new one, open this link within ${minutes} minutes:\n\n${link}\n\n` +
      `If you did not ask for this, ignore this email; your password stays the same.\n`,
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      `<p>Someone asked to reset the password of the account <b>${escapeHtml(account.login)}</b>. ` +
      `To choose a new one, open this link within ${minutes} minutes:</p>` +
      `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>` +
      `<p>If you did not ask for this, ignore this email; your password stays the same.</p>`,
  };
}
