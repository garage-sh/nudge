import { describe, expect, it } from 'vitest';
import { judgeConfigFromEnv, createJudge, type JudgeConfig } from './config.js';
import { noul } from './port.js';
import { TYPESAFE } from './test/recordings.js';

/** A fetch that records the URL called and returns a valid Noul response. */
function spyFetch() {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    urls.push(String(url));
    headers.push(new Headers(init.headers));
    return new Response(JSON.stringify(TYPESAFE.noul.body), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, urls, headers };
}

const request = { state: { text: 'Hello' }, questions: { billing: noul('Billing?') } };

describe('Judge chosen by configuration', () => {
  it.each([
    ['typesafe', 'https://api.typesafe.ai/v1/systemone'],
    ['openrouter', 'https://openrouter.ai/api/alpha/decisions'],
  ] as const)("%s: calls the provider's API with the key", async (provider, url) => {
    const spy = spyFetch();
    const config: JudgeConfig = { provider, apiKey: 'fake-key', model: null, baseUrl: null };

    await createJudge(config, { fetch: spy.fetch }).judge(request);

    expect(spy.urls).toEqual([url]);
    expect(spy.headers[0]!.get('authorization')).toBe('Bearer fake-key');
  });

  it('self_hosted: calls the configured server, without a key', async () => {
    const spy = spyFetch();
    await createJudge(
      { provider: 'self_hosted', apiKey: null, model: null, baseUrl: 'http://decider:8080' },
      { fetch: spy.fetch },
    ).judge(request);

    expect(spy.urls).toEqual(['http://decider:8080/v1/decisions']);
    expect(spy.headers[0]!.has('authorization')).toBe(false);
  });

  it('rejects an incomplete configuration', () => {
    expect(() =>
      createJudge({ provider: 'typesafe', apiKey: null, model: null, baseUrl: null }),
    ).toThrow(/key/);
    expect(() =>
      createJudge({ provider: 'self_hosted', apiKey: null, model: null, baseUrl: null }),
    ).toThrow(/URL/);
  });
});

describe('Judge from environment variables (fallback)', () => {
  it('reads NUDGE_JUDGE_PROVIDER, _API_KEY, _MODEL and _BASE_URL', () => {
    expect(
      judgeConfigFromEnv({
        NUDGE_JUDGE_PROVIDER: 'openrouter',
        NUDGE_JUDGE_API_KEY: 'sk-or-fake',
        NUDGE_JUDGE_MODEL: 'typesafe/jev-1.14',
      }),
    ).toEqual({
      provider: 'openrouter',
      apiKey: 'sk-or-fake',
      model: 'typesafe/jev-1.14',
      baseUrl: null,
    });
    expect(
      judgeConfigFromEnv({
        NUDGE_JUDGE_PROVIDER: 'self_hosted',
        NUDGE_JUDGE_BASE_URL: 'http://decider:8080',
      }),
    ).toEqual({
      provider: 'self_hosted',
      apiKey: null,
      model: null,
      baseUrl: 'http://decider:8080',
    });
  });

  it('without NUDGE_JUDGE_PROVIDER, no Judge (degraded mode)', () => {
    expect(judgeConfigFromEnv({})).toBeNull();
    expect(judgeConfigFromEnv({ NUDGE_JUDGE_PROVIDER: '' })).toBeNull();
  });

  it('rejects at startup an unknown provider or an incomplete configuration', () => {
    expect(() => judgeConfigFromEnv({ NUDGE_JUDGE_PROVIDER: 'gpt' })).toThrow(
      /NUDGE_JUDGE_PROVIDER/,
    );
    expect(() => judgeConfigFromEnv({ NUDGE_JUDGE_PROVIDER: 'typesafe' })).toThrow(
      /NUDGE_JUDGE_API_KEY/,
    );
    expect(() => judgeConfigFromEnv({ NUDGE_JUDGE_PROVIDER: 'self_hosted' })).toThrow(
      /NUDGE_JUDGE_BASE_URL/,
    );
  });
});
