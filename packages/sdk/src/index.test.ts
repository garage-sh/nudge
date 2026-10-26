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

describe('the Instance URL', () => {
  const secretKey = 'nk_sec_AbCdEf';

  it.each([
    ['plain http to a remote host', 'http://nudge.example', /https/],
    ['plain http to a private address', 'http://10.0.0.5:8080', /https/],
    ['another scheme', 'ftp://nudge.example', /https/],
    ['a string that is not a URL', 'nudge.example', /Invalid Instance URL/],
  ])(
    'rejects %s before any network call (the secret key would travel in clear)',
    (_case, url, message) => {
      const fetch = vi.fn<typeof globalThis.fetch>();

      expect(() => createClient({ url, secretKey, fetch })).toThrow(message);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['https', 'https://nudge.example', 'https://nudge.example/v1/feedbacks'],
    ['plain http to localhost', 'http://localhost:3000/', 'http://localhost:3000/v1/feedbacks'],
    ['plain http to 127.0.0.1', 'http://127.0.0.1:3000', 'http://127.0.0.1:3000/v1/feedbacks'],
    ['plain http to [::1]', 'http://[::1]:3000', 'http://[::1]:3000/v1/feedbacks'],
  ])('accepts %s', async (_case, url, endpoint) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ id: 'f-1', state: 'received' }),
    );

    await createClient({ url, secretKey, fetch }).sendFeedback({ text: 'Hello' });

    expect(fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST' }));
  });
});
