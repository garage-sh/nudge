import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

const attempts = (limiter: RateLimiter, key: string, count: number, now: number) =>
  Array.from({ length: count }, () => limiter.consume(key, now));

describe('Rate limiter', () => {
  it('allows `limit` attempts at once, then refuses, per key', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });

    expect(attempts(limiter, 'a', 4, 0)).toEqual([true, true, true, false]);
    expect(limiter.consume('b', 0)).toBe(true);
  });

  it('gives an attempt back every `windowMs / limit`, and says when', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
    attempts(limiter, 'a', 3, 0);

    expect(limiter.msUntilReset('a', 0)).toBe(20_000);
    expect(limiter.consume('a', 19_999)).toBe(false);
    expect(limiter.consume('a', 20_000)).toBe(true);
    expect(limiter.consume('a', 20_000)).toBe(false);
  });

  it('allows no burst of twice the limit around a window boundary', () => {
    const limiter = new RateLimiter({ limit: 10, windowMs: 60_000 });

    const beforeBoundary = attempts(limiter, 'a', 10, 59_999);
    const afterBoundary = attempts(limiter, 'a', 10, 60_001);

    expect(beforeBoundary.every(Boolean)).toBe(true);
    expect(afterBoundary.filter(Boolean)).toHaveLength(0);
  });

  it('forgets a key idle for a whole window: it starts over with a full bucket', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
    attempts(limiter, 'a', 2, 0);

    expect(attempts(limiter, 'a', 3, 60_000)).toEqual([true, true, false]);
  });

  it('tracks at most `maxKeys` keys, forgetting the least recently seen', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 }, 2);
    limiter.consume('a', 0);
    limiter.consume('b', 1);
    limiter.consume('a', 2);

    limiter.consume('c', 3);

    expect(limiter.consume('a', 4)).toBe(false);
    expect(limiter.consume('b', 4)).toBe(true);
  });

  it('keeps each attempt cheap with many live keys', () => {
    const limiter = new RateLimiter({ limit: 20, windowMs: 60_000 });
    for (let index = 0; index < 50_000; index += 1) limiter.consume(`ip-${index}`, index);

    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) limiter.consume(`late-${index}`, 50_000);
    const elapsed = performance.now() - started;

    // A scan of the 50,000 live keys on each attempt took seconds for these 10,000.
    expect(elapsed).toBeLessThan(500);
  });
});
