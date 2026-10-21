/**
 * Counts events per key over a sliding window.
 *
 * In memory, so the limits are per BFF instance: with several instances
 * behind a load balancer a client gets each limit once per instance. That
 * is still a hard cap on guessing, and keeps the BFF free of shared state
 * beyond its session store.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an attempt; false when the key is over its limit. */
  allow(key: string): boolean {
    if (this.blocked(key)) return false;
    this.record(key);
    return true;
  }

  /** Whether the key has used up its limit, without recording anything. */
  blocked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  /** Records one event against the key. */
  record(key: string): void {
    const at = this.now();
    const recent = this.recent(key);
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(at);
  }

  /** Forgets the key's events, e.g. after a successful sign-in. */
  clear(key: string): void {
    this.hits.delete(key);
  }

  /** Milliseconds until the key may try again; 0 when it may now. */
  retryAfterMs(key: string): number {
    const recent = this.recent(key);
    if (recent.length < this.limit) return 0;
    // The window frees up when the oldest event that keeps it full expires.
    const oldest = recent[recent.length - this.limit]!;
    return Math.max(0, oldest + this.windowMs - this.now());
  }

  private recent(key: string): number[] {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs);
    if (recent.length === 0) this.hits.delete(key);
    else this.hits.set(key, recent);
    return recent;
  }

  private prune(at: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => at - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
