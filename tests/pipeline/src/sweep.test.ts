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
 * A Feedback whose content the Judge refuses (a refused request, an unreadable answer)
 * would be refused again: it stays Received, retried by the sweep less and less often,
 * and never takes the place of the other Feedbacks left Received.
 */
describe('Sweep of Feedback whose Triage the Judge refuses', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({ sweep: { delayMs: 300, intervalMs: 100 } });
    pipeline.judge.refuse((request) => String(request.state.text).startsWith('REFUSED'));
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('a refused Feedback is sent to the Judge once per pass, at longer and longer intervals', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Refused content' });
    const text = 'REFUSED by the provider';
    const calls = () => pipeline.judge.requests.filter((r) => r.state.text === text).length;
    const start = performance.now();

    const response = await pipeline.postFeedback(secretKey, { text });
    const { id } = (await response.json()) as { id: string };

    // Three passes of the sweep wait 300, 300 then 600 ms at least: without a growing
    // wait, they would take 900 ms.
    await expect
      .poll(async () => (await pipeline.readFeedback(id))?.triageSweeps, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3);
    expect(performance.now() - start).toBeGreaterThanOrEqual(1200);
    // The refusal fails the job at once, without BullMQ retries: one Judge request per
    // Triage, the first one and one per pass of the sweep.
    await expect
      .poll(async () => calls() - (await pipeline.readFeedback(id))!.triageSweeps)
      .toBe(1);
    expect(await pipeline.readFeedback(id)).toMatchObject({ state: 'received', verdict: null });
  });

  it('100 refused Feedbacks do not keep a forgotten one from Triage', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Poisoned' });
    await pipeline.createDestination(project.id);
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const refused = Array.from({ length: 100 }, (_, i) => `REFUSED feedback ${i}`);
    for (const text of refused) await pipeline.postFeedback(secretKey, { text });
    await expect
      .poll(
        () => refused.every((text) => pipeline.judge.requests.some((r) => r.state.text === text)),
        { timeout: 20_000 },
      )
      .toBe(true);
    // Past the sweep delay, the refused ones are the oldest Feedbacks left Received.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Newer than all of them, and never queued.
    const id = await pipeline.insertFeedbackWithoutTriage(project.id, {
      text: 'Forgotten behind the refused ones',
    });

    const feedback = await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched', 10_000);
    expect(feedback.verdict).toMatchObject({ resolvedType: 'bug' });
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
    pipeline = await startPipeline({
      sweep: { delayMs: 300, intervalMs: 100 },
      // Enough slots that Deliveries held at a slow Destination leave room for the others.
      concurrency: { triage: 2, dispatch: 200, incidentLevel: 10 },
    });
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

  it('Deliveries whose job is under way do not keep a forgotten one from dispatch', async () => {
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const busy = await pipeline.createProject({ name: 'Busy destination' });
    const slow = await pipeline.createDestination(busy.project.id);
    const release = slow.fake.hold();
    try {
      // More pending Deliveries with a live job (running or waiting) than a sweep batch.
      const ids: string[] = [];
      for (let i = 0; i < 110; i += 1) {
        const response = await pipeline.postFeedback(busy.secretKey, { text: `Busy ${i}` });
        ids.push(((await response.json()) as { id: string }).id);
      }
      for (const id of ids) {
        await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched', 10_000);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));

      const { project, secretKey } = await pipeline.createProject({ name: 'Forgotten delivery' });
      const { destination, fake } = await pipeline.createDestination(project.id, {
        filter: { types: ['question'], minimumSeverity: null },
      });
      const response = await pipeline.postFeedback(secretKey, { text: 'Behind the busy ones' });
      const { id } = (await response.json()) as { id: string };
      await pipeline.waitForFeedback(id, (r) => r.state === 'triaged');
      const deliveryId = await pipeline.insertDeliveryWithoutDispatch(id, destination.id);

      await pipeline.waitForFeedback(
        id,
        (r) =>
          r.deliveries.some(
            (delivery) => delivery.id === deliveryId && delivery.status === 'delivered',
          ),
        10_000,
      );
      expect(fake.deliveries).toHaveLength(1);
      expect(slow.fake.deliveries).toHaveLength(0);
    } finally {
      release();
    }
  });
});
