import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

/**
 * Safety net against losing a Feedback between its insert and its enqueue (no
 * outbox) or after Triage has exhausted its retries: a periodic sweep hands the
 * Feedback left Received past a delay back to Triage.
 */
describe('Sweep of Feedback left Received', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({ sweep: { delayMs: 300, intervalMs: 100 } });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('a Feedback recorded but never enqueued ends up triaged and dispatched', async () => {
    const { project } = await pipeline.createProject({ name: 'Lost enqueue' });
    const { fake } = await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'bug', severity: 'major' });

    const id = await pipeline.insertFeedbackWithoutTriage(project.id, { text: 'Lost on the way' });

    const feedback = await pipeline.waitForFeedback(
      id,
      (r) => r.deliveries.some((delivery) => delivery.status === 'delivered'),
      10_000,
    );
    expect(feedback).toMatchObject({ state: 'dispatched', verdict: { resolvedType: 'bug' } });
    expect(fake.deliveries).toHaveLength(1);
  });

  it('a Feedback whose enqueue fails is accepted (202), then triaged by the sweep', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Redis down' });
    await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const repair = await pipeline.breakEnqueue('triage');
    let id: string;
    try {
      const response = await pipeline.postFeedback(secretKey, { text: 'Recorded despite Redis' });

      expect(response.status).toBe(202);
      ({ id } = (await response.json()) as { id: string });
      expect(await pipeline.readFeedback(id)).toMatchObject({ state: 'received' });
    } finally {
      await repair();
    }
    const feedback = await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched', 10_000);
    expect(feedback.verdict).toMatchObject({ resolvedType: 'bug' });
  });

  it('a Feedback whose Triage exhausted its retries is retried when the Judge comes back', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Judge long gone' });
    await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'suggestion', severity: 'minor' });
    pipeline.judge.fail(1000);
    const text = 'The Judge comes back later';

    const response = await pipeline.postFeedback(secretKey, { text });
    const { id } = (await response.json()) as { id: string };
    // The job's 8 attempts fail: without the sweep, the Feedback would stay Received.
    await expect
      .poll(() => pipeline.judge.requests.filter((r) => r.state.text === text).length, {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(8);
    expect(await pipeline.readFeedback(id)).toMatchObject({ state: 'received' });

    pipeline.judge.fail(0);
    const feedback = await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched', 10_000);
    expect(feedback.verdict).toMatchObject({ resolvedType: 'suggestion' });
  });

  it('a recent Received Feedback is not re-enqueued: a single Triage', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'No duplicate' });
    const release = pipeline.judge.hold();
    const text = 'Slow Triage, but in progress';

    const response = await pipeline.postFeedback(secretKey, { text });
    const { id } = (await response.json()) as { id: string };
    // Several sweeps run while the job is active.
    await new Promise((resolve) => setTimeout(resolve, 800));
    release();

    await pipeline.waitForFeedback(id, (r) => r.state === 'triaged');
    expect(pipeline.judge.requests.filter((r) => r.state.text === text)).toHaveLength(1);
  });
});

/**
 * Safety net against a Delivery stuck pending (D26): its enqueue failed after the
 * commit (Redis down during dispatch) or its job failed without finishing it
 * (Postgres down). The sweep hands it back to dispatch, without doubling a running job.
 */
describe('Sweep of Deliveries left pending', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({ sweep: { delayMs: 300, intervalMs: 100 } });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('a Delivery recorded but never enqueued ends up delivered', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Orphan delivery' });
    // The Filter does not accept the Feedback: it stays Triaged, with no Delivery nor job.
    const { destination, fake } = await pipeline.createDestination(project.id, {
      filter: { types: ['question'], minimumSeverity: null },
    });
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const response = await pipeline.postFeedback(secretKey, { text: 'Delivery lost on the way' });
    const { id } = (await response.json()) as { id: string };
    await pipeline.waitForFeedback(id, (r) => r.state === 'triaged');

    const deliveryId = await pipeline.insertDeliveryWithoutDispatch(id, destination.id);

    const feedback = await pipeline.waitForFeedback(
      id,
      (r) =>
        r.deliveries.some(
          (delivery) => delivery.id === deliveryId && delivery.status === 'delivered',
        ),
      10_000,
    );
    expect(feedback.deliveries).toHaveLength(1);
    expect(fake.deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
  });

  it('a Delivery whose job is running is not re-enqueued: a single call', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Slow delivery' });
    const { fake } = await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const release = fake.hold();

    const response = await pipeline.postFeedback(secretKey, { text: 'Slow Destination' });
    const { id } = (await response.json()) as { id: string };
    await expect.poll(() => fake.attempts.length).toBe(1);
    // Several sweeps run while the job waits for the Destination.
    await new Promise((resolve) => setTimeout(resolve, 800));
    release();

    await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.every((delivery) => delivery.status === 'delivered'),
    );
    expect(fake.attempts).toHaveLength(1);
  });
});
