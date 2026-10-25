/**
 * In-process memory rate limiter, fixed window, per key (IP…).
 * Accepted limit: it counts per api replica (no Redis for this, D8).
 */
/** `limit` attempts per fixed window of `windowMs`. */
export interface RateLimit {
  readonly limit: number;
  readonly windowMs: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly options: RateLimit) {}

  /** Counts an attempt for `key`; `false` if the window's limit is exceeded. */
  consume(key: string, now = Date.now()): boolean {
    this.purge(now);
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.options.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.options.limit;
  }

  /** Time left before the end of `key`'s current window (0 if none is open). */
  msUntilReset(key: string, now = Date.now()): number {
    const window = this.windows.get(key);
    if (!window) return 0;
    return Math.max(0, window.start + this.options.windowMs - now);
  }

  /** Forgets the expired windows, so that the table does not grow without end. */
  private purge(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.options.windowMs) this.windows.delete(key);
    }
  }
}
