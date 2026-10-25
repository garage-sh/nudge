import type { ProjectView } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

const ORIGIN = 'https://shop.example';

describe('Ingestion by public key (Widget)', () => {
  let pipeline: Pipeline;
  let publicKey: string;

  beforeAll(async () => {
    pipeline = await startPipeline();
    ({ publicKey } = await pipeline.createProject({
      name: 'Shop',
      allowedOrigins: [ORIGIN, 'http://localhost:5173'],
    }));
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('records a Feedback with the widget Source and a declared Author, then triages it', async () => {
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
      text: 'The pay button does not respond',
      type: 'bug',
      author: { id: 'u-7', email: 'ada@example.test', name: 'Ada' },
      context: {
        url: 'https://shop.example/cart',
        userAgent: 'Mozilla/5.0',
        viewport: { width: 390, height: 844 },
        metadata: { version: '4.2.0' },
      },
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const { id } = (await response.json()) as { id: string };
    expect(
      await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched' || r.state === 'triaged'),
    ).toMatchObject({
      source: 'widget',
      text: 'The pay button does not respond',
      declaredType: 'bug',
      author: { id: 'u-7', email: 'ada@example.test', name: 'Ada' },
      authorTrust: 'declared',
      context: { url: 'https://shop.example/cart', metadata: { version: '4.2.0' } },
    });
  });

  it('answers the browser’s CORS preflight', async () => {
    const response = await fetch(`${pipeline.url}/v1/feedbacks`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
  });

  it.each([
    ['an origin missing from the Project’s list', 'https://pirate.example'],
    ['a neighbouring origin (subdomain)', 'https://www.shop.example'],
    ['an origin on a different port', 'http://localhost:5174'],
    ['a request without an origin', null],
  ])('refuses %s', async (_case, origin) => {
    const response = await pipeline.postWidgetFeedback(publicKey, origin, { text: 'Hello' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'origin_refused' });
  });

  it('refuses an unknown public key', async () => {
    const response = await pipeline.postWidgetFeedback('nk_pub_unknown', ORIGIN, {
      text: 'Hello',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_key' });
  });

  it('refuses a malformed Feedback', async () => {
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, { text: '  ' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_feedback' });
  });

  it.each([
    ['in the Author', { author: { id: 'u-7', trust: 'attested' } }],
    ['at the root of the Feedback', { author: { id: 'u-7' }, authorTrust: 'attested' }],
  ])('refuses a browser that claims to attest the Author %s', async (_case, fields) => {
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
      text: 'Hello',
      ...fields,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_feedback' });
  });

  it('refuses the old public key after regeneration, accepts the new one', async () => {
    const member = await pipeline.signIn();
    const { body } = await member.post<{ project: ProjectView }>('/api/projects', {
      name: 'Regenerated',
      allowedOrigins: [ORIGIN],
    });
    const oldKey = body.project.publicKey;

    const regeneration = await member.post<ProjectView>(
      `/api/projects/${body.project.id}/public-key`,
    );

    const newKey = regeneration.body.publicKey;
    expect((await pipeline.postWidgetFeedback(oldKey, ORIGIN, { text: 'Old' })).status).toBe(401);
    expect((await pipeline.postWidgetFeedback(newKey, ORIGIN, { text: 'New' })).status).toBe(202);
  });
});

describe('Rate limit of ingestion by public key', () => {
  describe('per Project', () => {
    let pipeline: Pipeline;

    beforeAll(async () => {
      pipeline = await startPipeline({
        widgetLimits: {
          perIp: { limit: 100, windowMs: 60_000 },
          perProject: { limit: 2, windowMs: 60_000 },
        },
      });
    });

    afterAll(async () => {
      await pipeline?.stop();
    });

    it('refuses beyond the Project’s limit, without affecting other Projects', async () => {
      const { publicKey: flooded } = await pipeline.createProject({
        name: 'Flooded',
        allowedOrigins: [ORIGIN],
      });
      const { publicKey: neighbour } = await pipeline.createProject({
        name: 'Neighbour',
        allowedOrigins: [ORIGIN],
      });
      const post = (key: string) => pipeline.postWidgetFeedback(key, ORIGIN, { text: 'Again' });

      const statuses = [(await post(flooded)).status, (await post(flooded)).status];
      const refusal = await post(flooded);

      expect(statuses).toEqual([202, 202]);
      expect(refusal.status).toBe(429);
      expect(refusal.headers.get('retry-after')).toMatch(/^\d+$/);
      // The Widget reads Retry-After from another origin: the header must be exposed.
      expect(refusal.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(refusal.headers.get('access-control-expose-headers')).toMatch(/retry-after/i);
      expect(await refusal.json()).toMatchObject({ error: 'too_many_feedbacks' });
      expect((await post(neighbour)).status).toBe(202);
    });

    it('does not count the secret key against the Widget limit', async () => {
      const { publicKey, secretKey } = await pipeline.createProject({
        name: 'Server',
        allowedOrigins: [ORIGIN],
      });
      const widget = () => pipeline.postWidgetFeedback(publicKey, ORIGIN, { text: 'Widget' });
      await widget();
      await widget();

      expect((await widget()).status).toBe(429);
      expect((await pipeline.postFeedback(secretKey, { text: 'Server' })).status).toBe(202);
    });
  });

  describe('per IP', () => {
    let pipeline: Pipeline;

    beforeAll(async () => {
      pipeline = await startPipeline({
        widgetLimits: {
          perIp: { limit: 2, windowMs: 60_000 },
          perProject: { limit: 100, windowMs: 60_000 },
        },
      });
    });

    afterAll(async () => {
      await pipeline?.stop();
    });

    it('refuses an IP beyond its limit, across all Projects', async () => {
      const [a, b] = await Promise.all(
        ['A', 'B'].map((name) => pipeline.createProject({ name, allowedOrigins: [ORIGIN] })),
      );
      const post = (key: string) => pipeline.postWidgetFeedback(key, ORIGIN, { text: 'Again' });

      const statuses = [(await post(a!.publicKey)).status, (await post(b!.publicKey)).status];
      const refusal = await post(b!.publicKey);

      expect(statuses).toEqual([202, 202]);
      expect(refusal.status).toBe(429);
      expect(await refusal.json()).toMatchObject({ error: 'too_many_feedbacks' });
    });
  });
});

describe('Per-IP rate limit behind a reverse proxy (`trust proxy`)', () => {
  const postFrom = (pipeline: Pipeline, key: string, ip: string) =>
    fetch(`${pipeline.url}/v1/feedbacks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        origin: ORIGIN,
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ text: 'Behind the proxy' }),
    });

  const widgetLimits = {
    perIp: { limit: 1, windowMs: 60_000 },
    perProject: { limit: 100, windowMs: 60_000 },
  };

  describe('with a trusted proxy', () => {
    let pipeline: Pipeline;

    beforeAll(async () => {
      pipeline = await startPipeline({ widgetLimits, trustProxy: 1 });
    });

    afterAll(async () => {
      await pipeline?.stop();
    });

    it('counts each client by the IP the proxy forwards', async () => {
      const { publicKey } = await pipeline.createProject({
        name: 'Proxy',
        allowedOrigins: [ORIGIN],
      });

      expect((await postFrom(pipeline, publicKey, '203.0.113.1')).status).toBe(202);
      expect((await postFrom(pipeline, publicKey, '203.0.113.1')).status).toBe(429);
      expect((await postFrom(pipeline, publicKey, '203.0.113.2')).status).toBe(202);
    });
  });

  describe('without a declared proxy', () => {
    let pipeline: Pipeline;

    beforeAll(async () => {
      pipeline = await startPipeline({ widgetLimits });
    });

    afterAll(async () => {
      await pipeline?.stop();
    });

    it('ignores X-Forwarded-For: a client cannot bypass its limit by changing it', async () => {
      const { publicKey } = await pipeline.createProject({
        name: 'Direct',
        allowedOrigins: [ORIGIN],
      });

      expect((await postFrom(pipeline, publicKey, '203.0.113.1')).status).toBe(202);
      expect((await postFrom(pipeline, publicKey, '203.0.113.2')).status).toBe(429);
    });
  });
});
