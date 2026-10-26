import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

/** A Delivery is identified by (Feedback, Destination): replaying a job creates no duplicate. */
describe('Delivery idempotence', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function deliveredFeedback(name: string) {
    const { project, secretKey } = await pipeline.createProject({ name });
    const { fake } = await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const response = await pipeline.postFeedback(secretKey, { text: `Feedback from ${name}` });
    const { id } = (await response.json()) as { id: string };
    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((e) => e.status === 'delivered'),
    );
    return { feedback, fake };
  }

  it('a replayed Triage job creates neither a second Delivery nor a second call to the Destination', async () => {
    const { feedback, fake } = await deliveredFeedback('Replayed Triage');

    await pipeline.replayTriage(feedback.id);

    const after = await pipeline.readFeedback(feedback.id);
    expect(after?.deliveries).toEqual(feedback.deliveries);
    expect(fake.attempts).toHaveLength(1);
  });

  it('a Triage job replayed after the Dispatch does not serve a Destination added since', async () => {
    const { feedback, fake } = await deliveredFeedback('Destination added after');
    const added = await pipeline.createDestination(feedback.projectId, { name: 'Added after' });

    await pipeline.replayTriage(feedback.id);

    expect((await pipeline.readFeedback(feedback.id))?.deliveries).toEqual(feedback.deliveries);
    expect(added.fake.attempts).toHaveLength(0);
    expect(fake.attempts).toHaveLength(1);
  });

  it('a replayed Dispatch job does not deliver an already delivered Delivery a second time', async () => {
    const { feedback, fake } = await deliveredFeedback('Replayed Dispatch');
    const [delivery] = feedback.deliveries;

    await pipeline.replayDispatch(delivery!.id);

    expect((await pipeline.readFeedback(feedback.id))?.deliveries).toEqual(feedback.deliveries);
    expect(fake.attempts).toHaveLength(1);
  });
});

/**
 * The dispatch worker runs several jobs at once: a Delivery is claimed before it is
 * sent, so two of its jobs never send it twice, and a slow Destination does not hold
 * back the others.
 */
describe('Concurrent dispatch jobs', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function postTo(name: string, text: string) {
    const { project, secretKey } = await pipeline.createProject({ name });
    const { destination, fake } = await pipeline.createDestination(project.id);
    const response = await pipeline.postFeedback(secretKey, { text });
    const { id } = (await response.json()) as { id: string };
    return { id, destination, fake };
  }

  it('two jobs of the same Delivery send it only once', async () => {
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const { project, secretKey } = await pipeline.createProject({ name: 'Two jobs' });
    const { fake } = await pipeline.createDestination(project.id);
    const release = fake.hold();
    const response = await pipeline.postFeedback(secretKey, { text: 'Sent by two jobs' });
    const { id } = (await response.json()) as { id: string };
    await expect.poll(() => fake.attempts.length).toBe(1);

    // A second job of the same Delivery (a sweep's, a late retry's) while the first sends.
    await pipeline.enqueueDispatch(fake.attempts[0]!.deliveryId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fake.attempts).toHaveLength(1);
    release();

    await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.every((delivery) => delivery.status === 'delivered'),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.attempts).toHaveLength(1);
  });

  it('a slow Destination does not hold back the Deliveries of another Project', async () => {
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const { project, secretKey } = await pipeline.createProject({ name: 'Slow' });
    const slow = await pipeline.createDestination(project.id);
    const release = slow.fake.hold();
    try {
      await pipeline.postFeedback(secretKey, { text: 'Stuck at a slow Destination' });
      await expect.poll(() => slow.fake.attempts.length).toBe(1);

      const fast = await postTo('Fast', 'Not stuck behind it');

      await pipeline.waitForFeedback(fast.id, (r) =>
        r.deliveries.some((delivery) => delivery.status === 'delivered'),
      );
      expect(fast.fake.deliveries).toHaveLength(1);
      expect(slow.fake.deliveries).toHaveLength(0);
    } finally {
      release();
    }
  });

  it('a Delivery of a Feedback neither Triaged nor Dispatched is never sent', async () => {
    pipeline.judge.script({ type: 'opinion', junk: 0.9, severity: 'cosmetic' });
    const { id, destination, fake } = await postTo('Discarded', 'Buy cheap watches');
    await pipeline.waitForFeedback(id, (r) => r.state === 'discarded');
    const deliveryId = await pipeline.insertDeliveryWithoutDispatch(id, destination.id);

    await pipeline.replayDispatch(deliveryId);

    expect(fake.attempts).toHaveLength(0);
    expect((await pipeline.readFeedback(id))?.deliveries).toEqual([
      expect.objectContaining({
        id: deliveryId,
        status: 'failed',
        lastError: 'permanent: Feedback discarded, not dispatchable',
      }),
    ]);
  });
});
