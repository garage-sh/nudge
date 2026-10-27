import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DestinationWithGeneratedSecrets } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WebhookReceiver,
  startPipeline,
  type DashboardClient,
  type Pipeline,
  type WebhookRequest,
} from './harness/index.js';

/** What a receiver would do: recompute the signature with the secret shown at creation. */
function validSignature(request: WebhookRequest, secret: string): boolean {
  const timestamp = request.headers['x-nudge-timestamp'];
  const received = String(request.headers['x-nudge-signature'] ?? '');
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${request.body}`).digest('hex')}`;
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}

/** The real adapters of `@nudge/destinations`, against a local HTTP receiver. */
describe('Webhook Destination end to end', () => {
  let pipeline: Pipeline;
  let receiver: WebhookReceiver;
  let member: DashboardClient;

  beforeAll(async () => {
    [pipeline, receiver] = await Promise.all([
      startPipeline({ destinations: 'real' }),
      WebhookReceiver.start(),
    ]);
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await Promise.all([pipeline?.stop(), receiver?.stop()]);
  });

  async function webhookDestination(name: string) {
    const { project, secretKey } = await pipeline.createProject({ name });
    const path = `/${encodeURIComponent(name)}`;
    const creation = await member.post<DestinationWithGeneratedSecrets>(
      `/api/projects/${project.id}/destinations`,
      {
        type: 'webhook',
        name: 'Local receiver',
        config: { url: `${receiver.url}${path}` },
        filter: { types: ['bug'], minimumSeverity: null },
      },
    );
    expect(creation.status).toBe(201);
    return { project, secretKey, path, ...creation.body };
  }

  it('a Triaged Feedback reaches the receiver signed, and the Delivery is delivered', async () => {
    const { project, secretKey, path, destination, generatedSecrets } =
      await webhookDestination('Signed');
    pipeline.judge.script({ type: 'bug', severity: 'major' });

    const response = await pipeline.postFeedback(secretKey, {
      text: '@everyone the cart crashes',
    });
    const { id } = (await response.json()) as { id: string };

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((e) => e.status === 'delivered'),
    );
    const received = receiver.requests.filter((r) => r.path === path);
    expect(received).toHaveLength(1);
    expect(validSignature(received[0]!, generatedSecrets.signingSecret!)).toBe(true);
    expect(JSON.parse(received[0]!.body)).toMatchObject({
      event: 'feedback',
      isTest: false,
      delivery: { id: feedback.deliveries[0]!.id },
      project: { id: project.id },
      feedback: { id, text: '@everyone the cart crashes', type: 'bug', severity: 'major' },
    });
    expect(feedback.deliveries).toMatchObject([
      { destinationId: destination.id, status: 'delivered' },
    ]);
  });

  it('the Feedback’s Capture goes as base64 in the signed body', async () => {
    const { secretKey, path, generatedSecrets } = await webhookDestination('With Capture');
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2a, 0x2a]);

    const response = await pipeline.postFeedback(secretKey, {
      text: 'See the capture',
      capture: { contentType: 'image/png', data: png.toString('base64') },
    });
    const { id } = (await response.json()) as { id: string };

    await pipeline.waitForFeedback(id, (r) => r.deliveries.some((e) => e.status === 'delivered'));
    const [received] = receiver.requests.filter((r) => r.path === path);
    expect(validSignature(received!, generatedSecrets.signingSecret!)).toBe(true);
    expect(JSON.parse(received!.body).feedback.capture).toEqual({
      contentType: 'image/png',
      data: png.toString('base64'),
    });
  });

  it('"test" sends a signed sample Feedback, and returns the receiver’s refusal', async () => {
    const { path, destination, generatedSecrets } = await webhookDestination('Trial');

    const delivered = await member.post(`/api/destinations/${destination.id}/test`);

    expect(delivered.body).toEqual({ status: 'delivered', externalUrl: null });
    const [trial] = receiver.requests.filter((r) => r.path === path);
    expect(JSON.parse(trial!.body)).toMatchObject({ event: 'feedback', isTest: true });
    expect(validSignature(trial!, generatedSecrets.signingSecret!)).toBe(true);

    receiver.respondWith(path, 401, 'unknown signature');
    expect((await member.post(`/api/destinations/${destination.id}/test`)).body).toEqual({
      status: 'failed',
      failureClass: 'auth',
      message: 'HTTP 401: unknown signature',
    });
  });

  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['a unique local IPv6 address', 'http://[fd00:ec2::254]/'],
  ])(
    '"test" refuses %s without connecting: only public hosts and the allowed ones',
    async (_, url) => {
      const { project } = await pipeline.createProject({ name: `Internal ${url}` });
      const creation = await member.post<DestinationWithGeneratedSecrets>(
        `/api/projects/${project.id}/destinations`,
        {
          type: 'webhook',
          name: 'Internal',
          config: { url },
          filter: { types: ['bug'], minimumSeverity: null },
        },
      );

      const trial = await member.post(`/api/destinations/${creation.body.destination.id}/test`);

      expect(trial.body).toEqual({
        status: 'failed',
        failureClass: 'permanent',
        message: expect.stringContaining('NUDGE_OUTBOUND_ALLOWED_HOSTS'),
      });
    },
  );

  it('after regeneration, only the new secret verifies the signature', async () => {
    const { path, destination, generatedSecrets } = await webhookDestination('Rotation');
    const regeneration = await member.post<DestinationWithGeneratedSecrets>(
      `/api/destinations/${destination.id}/generated-secrets`,
    );

    await member.post(`/api/destinations/${destination.id}/test`);

    const [trial] = receiver.requests.filter((r) => r.path === path);
    expect(validSignature(trial!, regeneration.body.generatedSecrets.signingSecret!)).toBe(true);
    expect(validSignature(trial!, generatedSecrets.signingSecret!)).toBe(false);
  });
});
