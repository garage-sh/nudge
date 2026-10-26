import { createHmac } from 'node:crypto';
import type { ConfiguredDestination, OutgoingDelivery } from '@nudge/core';
import { describe, expect, it } from 'vitest';
import { resolveDestinationAdapter } from './index.js';
import { IN_REVIEW_ALERT, SUSPENSION_ALERT } from './test/alerts.js';
import { webhookAdapter } from './webhook.js';

const SECRET = 'test-signing-secret';
const NOW = new Date('2026-10-24T09:30:00.000Z');
const TIMESTAMP = '1792834200';

const DESTINATION: ConfiguredDestination = {
  id: '6f1c2a40-0000-4000-8000-000000000001',
  projectId: '6f1c2a40-0000-4000-8000-000000000002',
  name: 'Receiver',
  type: 'webhook',
  config: { url: 'https://receiver.test/nudge?channel=bugs' },
  secrets: { signingSecret: SECRET },
};

const DELIVERY: OutgoingDelivery = {
  deliveryId: '6f1c2a40-0000-4000-8000-000000000003',
  isTest: false,
  project: { id: DESTINATION.projectId!, name: 'Shop' },
  feedback: {
    id: '6f1c2a40-0000-4000-8000-000000000004',
    text: '@everyone <script>alert(1)</script> [click](javascript:alert(1)) **bold**',
    source: 'api',
    resolvedType: 'bug',
    severity: 'major',
    uncertain: true,
    author: { id: 'u-42', email: 'ada@client.test', trust: 'attested' },
    context: { url: 'https://shop.test/cart', metadata: { version: '2.3.1' } },
    capture: null,
    receivedAt: new Date('2026-10-24T09:29:58.000Z'),
    dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000004',
  },
};

interface ReceivedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Headers;
  readonly body: string;
}

/** A recorded receiver: it returns the given responses, in order, and keeps the requests. */
function receiver(...replies: ({ status: number; body?: string } | Error | 'hang')[]) {
  const requests: ReceivedRequest[] = [];
  let next = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      init,
      headers: new Headers(init.headers),
      body: String(init.body),
    });
    const reply = replies[Math.min(next++, replies.length - 1)] ?? { status: 204 };
    if (reply instanceof Error) throw reply;
    if (reply === 'hang') {
      // Never answers: only the adapter's timeout (signal) interrupts it.
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    }
    // A 204 or a 3xx has no body.
    const noBody = reply.status === 204 || (reply.status >= 300 && reply.status < 400);
    return new Response(noBody ? null : (reply.body ?? null), { status: reply.status });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const webhook = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  webhookAdapter(DESTINATION, { fetch, now: () => NOW, timeoutMs });

const expectedSignature = (timestamp: string, body: string) =>
  `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')}`;

describe('Webhook adapter', () => {
  it('POSTs the Feedback as JSON to the configured URL, raw text not rewritten', async () => {
    const { fetch, requests } = receiver({ status: 200 });

    expect(await webhook(fetch).send(DELIVERY)).toEqual({ status: 'delivered', externalUrl: null });

    const [request] = requests;
    expect(request?.url).toBe('https://receiver.test/nudge?channel=bugs');
    expect(request?.init.method).toBe('POST');
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.headers.get('x-nudge-event')).toBe('feedback');
    expect(request?.headers.get('x-nudge-delivery')).toBe(DELIVERY.deliveryId);
    expect(JSON.parse(request!.body)).toEqual({
      event: 'feedback',
      isTest: false,
      delivery: { id: DELIVERY.deliveryId },
      project: { id: DESTINATION.projectId!, name: 'Shop' },
      feedback: {
        id: DELIVERY.feedback.id,
        text: '@everyone <script>alert(1)</script> [click](javascript:alert(1)) **bold**',
        source: 'api',
        type: 'bug',
        severity: 'major',
        uncertain: true,
        author: { id: 'u-42', email: 'ada@client.test', name: null, trust: 'attested' },
        context: { url: 'https://shop.test/cart', metadata: { version: '2.3.1' } },
        capture: null,
        receivedAt: '2026-10-24T09:29:58.000Z',
        dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000004',
      },
    });
  });

  describe('alert (Alert destination)', () => {
    it('POSTs the signed alert, event "alert", with its stable id', async () => {
      const { fetch, requests } = receiver({ status: 200 });

      expect(await webhook(fetch).alert(IN_REVIEW_ALERT)).toEqual({
        status: 'delivered',
        externalUrl: null,
      });

      const [request] = requests;
      expect(request?.url).toBe('https://receiver.test/nudge?channel=bugs');
      expect(request?.headers.get('x-nudge-event')).toBe('alert');
      expect(request?.headers.get('x-nudge-alert')).toBe(IN_REVIEW_ALERT.id);
      expect(request?.headers.get('x-nudge-delivery')).toBeNull();
      expect(request?.headers.get('x-nudge-signature')).toBe(
        expectedSignature(TIMESTAMP, request!.body),
      );
      expect(JSON.parse(request!.body)).toEqual({
        event: 'alert',
        isTest: false,
        alert: {
          id: IN_REVIEW_ALERT.id,
          type: 'feedback_in_review',
          at: '2026-10-24T09:30:00.000Z',
          title: 'Feedback in review · @everyone *Shop*',
          summary: expect.stringContaining('influence Triage'),
          project: { id: IN_REVIEW_ALERT.project.id, name: '@everyone *Shop*' },
          feedback: { id: IN_REVIEW_ALERT.feedback.id },
          dashboardUrl: IN_REVIEW_ALERT.dashboardUrl,
        },
      });
    });

    it('for a Suspended Destination, passes its class and the refusal as is', async () => {
      const { fetch, requests } = receiver({ status: 204 });

      await webhook(fetch).alert(SUSPENSION_ALERT);

      expect(JSON.parse(requests[0]!.body).alert).toMatchObject({
        type: 'destination_suspended',
        destination: {
          id: SUSPENSION_ALERT.destination.id,
          name: 'Linear [prod](https://trap.test)',
          failureClass: 'auth',
          message: 'HTTP 401: <!channel> @here `token` rejected',
        },
        dashboardUrl: null,
      });
    });

    it("classifies the receiver's refusal like a Delivery", async () => {
      const { fetch } = receiver({ status: 503 }, { status: 401 });
      const adapter = webhook(fetch);

      expect(await adapter.alert(IN_REVIEW_ALERT)).toMatchObject({ failureClass: 'transient' });
      expect(await adapter.alert(IN_REVIEW_ALERT)).toMatchObject({ failureClass: 'auth' });
    });
  });

  describe('Capture', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);
    const withCapture = (read: () => Promise<Uint8Array | null>): OutgoingDelivery => ({
      ...DELIVERY,
      feedback: { ...DELIVERY.feedback, capture: { contentType: 'image/png', bytes: 9, read } },
    });

    it('attaches it to the JSON in base64, under the signature (D10)', async () => {
      const { fetch, requests } = receiver({ status: 204 });

      expect(await webhook(fetch).send(withCapture(async () => PNG))).toEqual({
        status: 'delivered',
        externalUrl: null,
      });

      const body = requests[0]!.body;
      expect(JSON.parse(body).feedback.capture).toEqual({
        contentType: 'image/png',
        data: 'iVBORw0KGgr/',
      });
      expect(requests[0]!.headers.get('x-nudge-signature')).toBe(
        expectedSignature(TIMESTAMP, body),
      );
    });

    it('sends the Feedback without it if storage no longer has it', async () => {
      const { fetch, requests } = receiver({ status: 204 });

      await webhook(fetch).send(withCapture(async () => null));

      expect(JSON.parse(requests[0]!.body).feedback.capture).toBeNull();
    });

    it('unreachable storage: transient failure, without calling the receiver', async () => {
      const { fetch, requests } = receiver({ status: 204 });

      const result = await webhook(fetch).send(
        withCapture(() => Promise.reject(new Error('S3 GET: HTTP 503'))),
      );

      expect(result).toEqual({
        status: 'failed',
        failureClass: 'transient',
        message: 'Unreadable Capture: S3 GET: HTTP 503',
      });
      expect(requests).toEqual([]);
    });
  });

  it("signs the raw body and the timestamp with HMAC-SHA256 using the Destination's secret", async () => {
    const { fetch, requests } = receiver({ status: 204 });

    await webhook(fetch).send(DELIVERY);

    const [request] = requests;
    expect(request?.headers.get('x-nudge-timestamp')).toBe(TIMESTAMP);
    expect(request?.headers.get('x-nudge-signature')).toBe(
      expectedSignature(TIMESTAMP, request!.body),
    );
    // Another secret does not produce the same signature.
    const other = createHmac('sha256', 'other').update(`${TIMESTAMP}.${request!.body}`);
    expect(request?.headers.get('x-nudge-signature')).not.toBe(`sha256=${other.digest('hex')}`);
  });

  it('marks the sample Feedback of the "test" button', async () => {
    const { fetch, requests } = receiver({ status: 200 });

    await webhook(fetch).send({ ...DELIVERY, isTest: true });

    expect(JSON.parse(requests[0]!.body)).toMatchObject({ event: 'feedback', isTest: true });
  });

  it('does not follow redirects: a 3xx is a permanent failure', async () => {
    const { fetch, requests } = receiver({ status: 301 });

    expect(await webhook(fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'permanent',
    });
    expect(requests[0]?.init.redirect).toBe('manual');
  });

  it.each([
    [200, 'delivered'],
    [202, 'delivered'],
    [204, 'delivered'],
    [408, 'transient'],
    [425, 'transient'],
    [429, 'transient'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'transient'],
    [401, 'auth'],
    [403, 'auth'],
    [400, 'permanent'],
    [404, 'permanent'],
    [410, 'permanent'],
    [413, 'permanent'],
    [422, 'permanent'],
  ])('classifies a %i response: %s', async (status, expected) => {
    const { fetch } = receiver({ status, body: 'receiver detail' });

    const result = await webhook(fetch).send(DELIVERY);

    if (expected === 'delivered') {
      expect(result).toEqual({ status: 'delivered', externalUrl: null });
    } else {
      expect(result).toEqual({
        status: 'failed',
        failureClass: expected,
        message: expect.stringContaining(String(status)),
      });
    }
  });

  it("carries the start of the receiver's response into the failure message, bounded", async () => {
    const { fetch } = receiver({ status: 422, body: `missing field ${'x'.repeat(1000)}` });

    const result = await webhook(fetch).send(DELIVERY);

    expect(result).toMatchObject({ message: expect.stringContaining('missing field') });
    expect(result.status === 'failed' && result.message.length).toBeLessThan(400);
  });

  it('reads only the start of a refusal: an endless body is cancelled, not downloaded', async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1024;
        controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = (async () => new Response(endless, { status: 500 })) as typeof globalThis.fetch;

    const result = await webhook(fetch).send(DELIVERY);

    expect(result).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/^HTTP 500: x+…$/),
    });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(64 * 1024);
  });

  it('a network error is transient', async () => {
    const { fetch } = receiver(new TypeError('fetch failed'));

    expect(await webhook(fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
      message: expect.stringContaining('fetch failed'),
    });
  });

  it('a receiver that does not answer within the timeout is transient', async () => {
    const { fetch } = receiver('hang');

    expect(await webhook(fetch, 50).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
    });
  });

  describe('healthCheck', () => {
    it('sends a signed ping; a 2xx response makes the Destination reachable', async () => {
      const { fetch, requests } = receiver({ status: 200 });

      expect(await webhook(fetch).healthCheck()).toEqual({ reachable: true });

      const [request] = requests;
      expect(request?.init.method).toBe('POST');
      expect(request?.headers.get('x-nudge-event')).toBe('ping');
      expect(JSON.parse(request!.body)).toEqual({ event: 'ping' });
      expect(request?.headers.get('x-nudge-signature')).toBe(
        expectedSignature(TIMESTAMP, request!.body),
      );
    });

    it.each([
      [503, 'transient'],
      [401, 'auth'],
      [404, 'permanent'],
    ])('a %i response makes the Destination unreachable (%s)', async (status, failureClass) => {
      const { fetch } = receiver({ status });

      expect(await webhook(fetch).healthCheck()).toMatchObject({
        reachable: false,
        failureClass,
      });
    });
  });

  it('is registered for the "webhook" type in the adapter registry', async () => {
    const adapter = resolveDestinationAdapter(DESTINATION);

    expect(typeof adapter.send).toBe('function');
    expect(typeof adapter.healthCheck).toBe('function');
  });
});
