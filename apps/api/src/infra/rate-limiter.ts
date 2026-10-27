import { isIPv6 } from 'node:net';

/**
 * In-process memory rate limiter, token bucket, per key (a client, see `clientKey`…).
 * Accepted limit: it counts per api replica (no Redis for this, D8).
 */
/**
 * `limit` attempts per `windowMs`: a burst of `limit` at most, then the bucket refills
 * at `limit` per `windowMs`. Unlike a fixed window, no burst of twice the limit
 * around a window boundary.
 */
export interface RateLimit {
  readonly limit: number;
  readonly windowMs: number;
}

/** Keys tracked at most: beyond, the least recently seen ones are forgotten. */
const DEFAULT_MAX_KEYS = 100_000;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  /**
   * In order of last attempt (each attempt moves its key to the end): the buckets
   * refilled the longest ago are at the front, where `purge` finds them.
   */
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly options: RateLimit,
    private readonly maxKeys = DEFAULT_MAX_KEYS,
  ) {}

  /** Counts an attempt for `key`; `false` if its bucket is empty (a refusal costs nothing). */
  consume(key: string, now = Date.now()): boolean {
    this.purge(now);
    const tokens = this.tokens(key, now);
    const allowed = tokens >= 1;
    this.buckets.delete(key);
    this.buckets.set(key, { tokens: allowed ? tokens - 1 : tokens, updatedAt: now });
    if (this.buckets.size > this.maxKeys) this.forgetOldest();
    return allowed;
  }

  /** Time left before `key` can make an attempt again (0 if it can now). */
  msUntilReset(key: string, now = Date.now()): number {
    const tokens = this.tokens(key, now);
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) / this.refillPerMs);
  }

  private get refillPerMs(): number {
    return this.options.limit / this.options.windowMs;
  }

  private tokens(key: string, now: number): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.options.limit;
    const elapsed = Math.max(0, now - bucket.updatedAt);
    return Math.min(this.options.limit, bucket.tokens + elapsed * this.refillPerMs);
  }

  /**
   * Forgets the buckets full again (a whole window without an attempt), so that the
   * table does not grow without end. They are at the front: stops at the first one
   * still in use, so each consume costs O(1) amortized.
   */
  private purge(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt < this.options.windowMs) return;
      this.buckets.delete(key);
    }
  }

  /** Too many distinct keys in one window: the least recently seen starts over full. */
  private forgetOldest(): void {
    const oldest = this.buckets.keys().next();
    if (!oldest.done) this.buckets.delete(oldest.value);
  }
}

/**
 * The key a client is counted under: its IPv4 address, or the /64 prefix of its IPv6
 * address. A single client commonly holds a whole /64, so counting each IPv6 address
 * apart would give it billions of buckets.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  const address = ip.split('%')[0]!;
  if (!isIPv6(address)) return ip;
  // An embedded IPv4 address (always last) stands for two groups.
  const groups = (part: string) =>
    part ? part.split(':').flatMap((group) => (group.includes('.') ? ['0', '0'] : [group])) : [];
  const [head = '', tail] = address.split('::');
  const leading = groups(head);
  const trailing = tail === undefined ? [] : groups(tail);
  const zeros = Array<string>(8 - leading.length - trailing.length).fill('0');
  const prefix = [...leading, ...zeros, ...trailing].slice(0, 4);
  return `${prefix.map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}
