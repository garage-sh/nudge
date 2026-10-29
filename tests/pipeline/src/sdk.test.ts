import { createClient, NudgeError } from '@nudge/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

describe('JS SDK (secret key)', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('sends a Feedback with Source api and an attested Author, that the pipeline triages and dispatches', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Support' });
    const { fake } = await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const nudge = createClient({ url: pipeline.url, secretKey });

    const received = await nudge.sendFeedback({
      text: 'The CSV export has been empty since this morning',
      type: 'bug',
      author: { id: 'u-42', email: 'ada@client.test', name: 'Ada' },
      context: { metadata: { channel: 'support', version: '3.1.0' } },
    });

    expect(received).toEqual({ id: expect.any(String), state: 'received' });
    const feedback = await pipeline.waitForFeedback(received.id, (r) =>
      r.deliveries.some((delivery) => delivery.status === 'delivered'),
    );
    expect(feedback).toMatchObject({
      state: 'dispatched',
      source: 'api',
      text: 'The CSV export has been empty since this morning',
      declaredType: 'bug',
      author: { id: 'u-42', email: 'ada@client.test', name: 'Ada' },
      authorTrust: 'attested',
      context: { metadata: { channel: 'support', version: '3.1.0' } },
    });
    expect(fake.deliveries).toHaveLength(1);
  });

  it('rejects a Feedback refused by the Instance with the API code and the field details', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Refusal' });
    const nudge = createClient({ url: `${pipeline.url}/`, secretKey });

    const refusal = await nudge
      .sendFeedback({ text: 'Hello', context: { url: 'not a url' } })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(NudgeError);
    expect(refusal).toMatchObject({
      status: 400,
      code: 'invalid_feedback',
      details: [{ path: 'context.url', message: expect.any(String) }],
    });
  });

  it('rejects an unknown or revoked secret key', async () => {
    const nudge = createClient({ url: pipeline.url, secretKey: 'nk_sec_revoked' });

    await expect(nudge.sendFeedback({ text: 'Hello' })).rejects.toMatchObject({
      name: 'NudgeError',
      status: 401,
      code: 'invalid_key',
    });
  });

  it('does not attest an Author without an identity', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Anonymous' });
    const nudge = createClient({ url: pipeline.url, secretKey });

    const { id } = await nudge.sendFeedback({ text: 'Thanks for the update', author: {} });

    expect(await pipeline.readFeedback(id)).toMatchObject({ author: null, authorTrust: null });
  });

  it('reports an Incident: the first Occurrence opens it, the same one again is absorbed', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Incidents' });
    const nudge = createClient({ url: pipeline.url, secretKey });
    const occurrence = {
      title: 'Payment provider timed out',
      level: 'critical',
      environment: 'production',
      context: { service: 'checkout' },
    } as const;

    const opened = await nudge.sendIncident(occurrence);
    const absorbed = await nudge.sendIncident(occurrence);

    expect(opened).toEqual({ id: expect.any(String), state: 'open', opened: true });
    expect(absorbed).toEqual({ id: opened.id, state: 'open', opened: false });
  });

  it('rejects an Incident refused by the Instance with the API code and the field details', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Incident refusal' });
    const nudge = createClient({ url: pipeline.url, secretKey });

    const refusal = await nudge
      .sendIncident({ title: 'Hello', level: 'fatal' as 'error' })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(NudgeError);
    expect(refusal).toMatchObject({
      status: 400,
      code: 'invalid_incident',
      details: [{ path: 'level', message: expect.any(String) }],
    });
  });
});
