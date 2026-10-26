import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

describe('Ingestion by secret key', () => {
  let pipeline: Pipeline;
  let secretKey: string;

  beforeAll(async () => {
    pipeline = await startPipeline();
    ({ secretKey } = await pipeline.createProject({ name: 'Ingestion' }));
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('refuses a call without a secret key or with an unknown key', async () => {
    const withoutKey = await fetch(`${pipeline.url}/v1/feedbacks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });
    const unknownKey = await pipeline.postFeedback('nk_sec_unknown', { text: 'Hello' });

    expect(withoutKey.status).toBe(401);
    expect(unknownKey.status).toBe(401);
  });

  it.each([
    ['an empty text', { text: '   ' }],
    ['a text that is too long', { text: 'a'.repeat(5001) }],
    ['an unknown field', { text: 'Hello', priority: 'high' }],
    ['an unknown Type', { text: 'Hello', type: 'complaint' }],
    ['an invalid context URL', { text: 'Hello', context: { url: 'not a url' } }],
    [
      'too much metadata',
      {
        text: 'Hello',
        context: {
          metadata: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])),
        },
      },
    ],
  ])('refuses %s', async (_case, body) => {
    const response = await pipeline.postFeedback(secretKey, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_feedback' });
  });

  it('stores the text as is, without its control characters, and marks the Author as attested', async () => {
    const response = await pipeline.postFeedback(secretKey, {
      text: '  Line 1\u0000\u0007\nLine 2\u001b\u009b',
      type: 'suggestion',
      author: { id: 'u-42', email: 'ada@example.test', name: 'Ada\u0008' },
      context: {
        userAgent: 'Mozilla/5.0',
        viewport: { width: 1280, height: 800 },
        metadata: { version: '2.3.1', beta: true },
      },
    });

    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect(await pipeline.readFeedback(id)).toMatchObject({
      source: 'api',
      text: '  Line 1\nLine 2',
      declaredType: 'suggestion',
      author: { id: 'u-42', email: 'ada@example.test', name: 'Ada' },
      authorTrust: 'attested',
      context: {
        userAgent: 'Mozilla/5.0',
        viewport: { width: 1280, height: 800 },
        metadata: { version: '2.3.1', beta: true },
      },
    });
  });
});

describe('Ingestion by secret key, unknown keys', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('refuses an IP that tried too many unknown keys, before looking the key up', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Guessed' });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const unknownKey = await pipeline.postFeedback(`nk_sec_unknown${attempt}`, { text: 'Hi' });
      expect(unknownKey.status).toBe(401);
    }

    const refusal = await pipeline.postFeedback(secretKey, { text: 'Hello' });

    expect(refusal.status).toBe(429);
    expect(await refusal.json()).toEqual({ error: 'too_many_attempts' });
    expect(refusal.headers.get('retry-after')).toMatch(/^\d+$/);
  });
});
