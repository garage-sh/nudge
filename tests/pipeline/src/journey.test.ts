import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

describe('Journey of a Feedback through the pipeline', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('Received → Triaged → Dispatched: the Feedback posted with the secret key is delivered to the Project’s Destination', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Shop' });
    const { destination, fake } = await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const release = pipeline.judge.hold();

    const response = await pipeline.postFeedback(secretKey, {
      text: 'The "Pay" button no longer responds',
      context: { url: 'https://shop.test/cart' },
    });

    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect(await pipeline.readFeedback(id)).toMatchObject({
      state: 'received',
      source: 'api',
      deliveries: [],
    });

    release();
    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((delivery) => delivery.status === 'delivered'),
    );

    expect(feedback).toMatchObject({
      state: 'dispatched',
      verdict: { resolvedType: 'bug', severity: 'major' },
      deliveries: [
        { destinationId: destination.id, status: 'delivered', externalUrl: expect.any(String) },
      ],
    });
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0]).toMatchObject({
      project: { id: project.id, name: 'Shop' },
      feedback: {
        id,
        text: 'The "Pay" button no longer responds',
        resolvedType: 'bug',
        severity: 'major',
      },
    });
  });

  it('Received → Triaged: without a Destination, the Feedback stays Triaged with its Verdict and no Delivery', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'No Destination' });
    pipeline.judge.script({ type: 'question', severity: 'cosmetic' });

    const response = await pipeline.postFeedback(secretKey, { text: 'Where are my invoices?' });
    const { id } = (await response.json()) as { id: string };

    const feedback = await pipeline.waitForFeedback(id, (r) => r.verdict !== null);
    expect(feedback).toMatchObject({
      state: 'triaged',
      verdict: { resolvedType: 'question', severity: 'cosmetic' },
      deliveries: [],
    });
  });

  it('an adapter exception is a transient failure: the Delivery is retried, then delivered', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Flaky network' });
    const { fake } = await pipeline.createDestination(project.id);
    fake.scriptSends(new Error('ECONNRESET'));

    const response = await pipeline.postFeedback(secretKey, { text: 'The page freezes' });
    const { id } = (await response.json()) as { id: string };

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((delivery) => delivery.status === 'delivered'),
    );
    expect(feedback.deliveries).toMatchObject([{ status: 'delivered', attempts: 2 }]);
    expect(fake.attempts).toHaveLength(2);
    expect(fake.deliveries).toHaveLength(1);
  });
});
