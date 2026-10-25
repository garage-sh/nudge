import { describe, expect, it, vi } from 'vitest';
import { createClient } from './index.js';

describe('createClient', () => {
  it.each([
    ["the Project's public key", 'nk_pub_AbCdEf', /public key/i],
    ['a string that is not a nudge key', 'sk_live_123', /nk_sec_/],
  ])('rejects %s before any network call', (_case, key, message) => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    expect(() => createClient({ url: 'https://nudge.example', secretKey: key, fetch })).toThrow(
      message,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
