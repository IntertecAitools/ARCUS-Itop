import { randomBytes } from "node:crypto";

import type { Caller } from "../../core/request-context.js";

/**
 * Where signed-in sessions live.
 *
 * A staff session carries the user's iTop password: iTop's REST API needs
 * credentials on every call and no token module is installed. So any store
 * that writes sessions down must encrypt them (see MySqlSessionStore).
 */
export interface SessionStore {
  /** Starts a session and returns its id, the cookie value. */
  create(caller: Caller): Promise<string>;
  /** The live session for an id, refreshing its idle timer; undefined once expired. */
  get(id: string | undefined): Promise<Caller | undefined>;
  /** Replaces what a session knows about its user, e.g. after a password change. */
  update(id: string, caller: Caller): Promise<void>;
  delete(id: string | undefined): Promise<void>;
  /** Signs a user out everywhere: after a password reset or a disable. */
  deleteForUser(userId: number): Promise<void>;
  /** Fails fast at startup when the store cannot be reached. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

/** 256 bits of randomness, URL-safe: unguessable and cookie-friendly. */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** Has a session outlived its idle window or its maximum life? */
export function isExpired(
  session: { createdAt: number; lastSeen: number },
  at: number,
  idleMs: number,
  maxMs: number,
): boolean {
  return at - session.lastSeen > idleMs || at - session.createdAt > maxMs;
}

interface Session {
  caller: Caller;
  createdAt: number;
  lastSeen: number;
}

/**
 * Sessions in this process's memory: nothing is written down, but a restart
 * signs everyone out and only one BFF instance can run. The default; set
 * SESSION_STORE=mysql to keep sessions across restarts.
 */
export class MemorySessionStore implements SessionStore {
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

  async create(caller: Caller): Promise<string> {
    const id = newSessionId();
    const at = this.now();
    this.sessions.set(id, { caller, createdAt: at, lastSeen: at });
    return id;
  }

  async get(id: string | undefined): Promise<Caller | undefined> {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const at = this.now();
    if (isExpired(session, at, this.idleMs, this.maxMs)) {
      this.sessions.delete(id);
      return undefined;
    }
    session.lastSeen = at;
    return session.caller;
  }

  async update(id: string, caller: Caller): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.caller = caller;
  }

  async delete(id: string | undefined): Promise<void> {
    if (id) this.sessions.delete(id);
  }

  async deleteForUser(userId: number): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.caller.userId === userId) this.sessions.delete(id);
    }
  }

  async ready(): Promise<void> {}

  private sweep(): void {
    const at = this.now();
    for (const [id, s] of this.sessions) {
      if (isExpired(s, at, this.idleMs, this.maxMs)) this.sessions.delete(id);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
  }
}
