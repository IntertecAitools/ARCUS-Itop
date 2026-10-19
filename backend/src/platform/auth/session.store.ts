import { randomBytes } from "node:crypto";

import type { Caller } from "../../core/request-context.js";

interface Session {
  caller: Caller;
  createdAt: number;
  lastSeen: number;
}

/**
 * Sessions, held in this process's memory.
 *
 * Memory rather than a database on purpose: a staff session carries the
 * user's iTop password (iTop's REST API needs credentials on every call and
 * no token module is installed), and that must never be written anywhere.
 * The cost is that a BFF restart signs everyone out, and that the BFF runs as
 * one instance; put a shared store in front only together with encrypting
 * what it holds.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly idleMs: number,
    private readonly maxMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 5 * 60_000);
    this.sweeper.unref();
  }

  create(caller: Caller): string {
    // 256 bits of randomness, URL-safe: unguessable and cookie-friendly.
    const id = randomBytes(32).toString("base64url");
    const at = this.now();
    this.sessions.set(id, { caller, createdAt: at, lastSeen: at });
    return id;
  }

  /** The live session for an id, refreshing its idle timer; undefined once expired. */
  get(id: string | undefined): Caller | undefined {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const at = this.now();
    if (at - session.lastSeen > this.idleMs || at - session.createdAt > this.maxMs) {
      this.sessions.delete(id);
      return undefined;
    }
    session.lastSeen = at;
    return session.caller;
  }

  /** Replaces what a session knows about its user, e.g. after a password change. */
  update(id: string, caller: Caller): void {
    const session = this.sessions.get(id);
    if (session) session.caller = caller;
  }

  delete(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  /** Signs a user out everywhere: after a password reset or a disable. */
  deleteForUser(userId: number): void {
    for (const [id, session] of this.sessions) {
      if (session.caller.userId === userId) this.sessions.delete(id);
    }
  }

  private sweep(): void {
    const at = this.now();
    for (const [id, s] of this.sessions) {
      if (at - s.lastSeen > this.idleMs || at - s.createdAt > this.maxMs) this.sessions.delete(id);
    }
  }

  close(): void {
    clearInterval(this.sweeper);
  }
}
