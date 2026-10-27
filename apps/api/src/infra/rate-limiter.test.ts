import { describe, expect, it } from 'vitest';
import { clientKey, RateLimiter } from './rate-limiter.js';

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

describe('Client key', () => {
  it('keeps an IPv4 address whole', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('reads an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('shortens an IPv6 address to its /64: one client holds the whole prefix', () => {
    const key = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');

    expect(key).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002::1')).toBe(key);
    expect(clientKey('2001:db8:1:2::abcd%eth0')).toBe(key);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(key);
  });

  it('expands a compressed IPv6 prefix', () => {
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
  });

  it('groups clients without an address together', () => {
    expect(clientKey(undefined)).toBe('unknown');
  });
});
