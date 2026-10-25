import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeliveryView, FeedbackDetailView } from '@nudge/shared';
import { failure, startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

/** A Member acts on a Feedback from the dashboard: review, Verdict correction, replay. */
describe('Review and corrections through the dashboard API', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function feedbackIn(state: 'in_review' | 'discarded') {
    const { project, secretKey } = await pipeline.createProject({
      name: `Project ${state}`,
    });
    const { fake } = await pipeline.createDestination(project.id);
    pipeline.judge.script(
      state === 'in_review'
        ? { type: 'bug', manipulation: 0.9, severity: 'major' }
        : { type: 'opinion', junk: 0.9, severity: 'cosmetic' },
    );
    const response = await pipeline.postFeedback(secretKey, { text: `Feedback ${state}` });
    const { id } = (await response.json()) as { id: string };
    await pipeline.waitForFeedback(id, (r) => r.state === state);
    return { id, fake };
  }

  it('without a session, a review is refused and changes nothing', async () => {
    const { id, fake } = await feedbackIn('in_review');

    const response = await pipeline
      .dashboard()
      .post(`/api/feedbacks/${id}/review`, { action: 'approve' });

    expect(response.status).toBe(401);
    expect(await pipeline.readFeedback(id)).toMatchObject({ state: 'in_review', deliveries: [] });
    expect(fake.attempts).toHaveLength(0);
  });

  it('an unknown review action is refused', async () => {
    const { id } = await feedbackIn('in_review');

    const response = await member.post(`/api/feedbacks/${id}/review`, { action: 'dispatch' });

    expect(response.status).toBe(400);
    expect(await pipeline.readFeedback(id)).toMatchObject({ state: 'in_review' });
  });

  /** A major Bug Feedback, dispatched and delivered to its Destination; Uncertain if `uncertain`. */
  async function deliveredFeedback(name: string, { uncertain = false } = {}) {
    const { project, secretKey } = await pipeline.createProject({ name });
    const { destination, fake } = await pipeline.createDestination(project.id);
    pipeline.judge.script(
      { type: 'bug', severity: 'major' },
      uncertain ? { confidence: 0.4 } : undefined,
    );
    const response = await pipeline.postFeedback(secretKey, { text: `Feedback from ${name}` });
    const { id } = (await response.json()) as { id: string };
    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((delivery) => delivery.status === 'delivered'),
    );
    return { feedback, destination, fake };
  }

  /** Gives the worker time to run, to observe that nothing happened. */
  const letItRun = () => new Promise((resolve) => setTimeout(resolve, 300));

  it('correcting the Type and Severity updates the Verdict, without changing anything at Destinations already served', async () => {
    const { feedback, fake } = await deliveredFeedback('Correction', { uncertain: true });

    const response = await member.patch<FeedbackDetailView>(
      `/api/feedbacks/${feedback.id}/verdict`,
      {
        resolvedType: 'question',
        severity: 'cosmetic',
      },
    );

    expect(response.status).toBe(200);
    // Corrected by a Member: the Verdict is checked, it is no longer Uncertain.
    expect(response.body.verdict).toEqual({
      resolvedType: 'question',
      severity: 'cosmetic',
      junk: false,
      manipulation: false,
      uncertain: false,
    });
    expect(response.body.state).toBe('dispatched');
    await letItRun();
    const after = await pipeline.readFeedback(feedback.id);
    expect(after?.deliveries).toEqual(feedback.deliveries);
    expect(fake.attempts).toHaveLength(1);
  });

  it('a Feedback not yet triaged has no Verdict to correct, and an empty correction is refused', async () => {
    const { project } = await pipeline.createProject({ name: 'Not triaged' });
    const received = await pipeline.insertFeedbackWithoutTriage(project.id, { text: 'Waiting' });
    const { feedback } = await deliveredFeedback('Empty correction');

    const notTriaged = await member.patch(`/api/feedbacks/${received}/verdict`, {
      resolvedType: 'bug',
    });
    const empty = await member.patch(`/api/feedbacks/${feedback.id}/verdict`, {});

    expect(notTriaged).toMatchObject({ status: 409, body: { error: 'feedback_not_triaged' } });
    expect(empty).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect((await pipeline.readFeedback(received))?.verdict).toBeNull();
    expect((await pipeline.readFeedback(feedback.id))?.verdict).toEqual(feedback.verdict);
  });

  it('replaying a failed Delivery delivers it: the same Delivery, with the link to the created object', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Replay of a failure',
    });
    const { fake } = await pipeline.createDestination(project.id);
    fake.scriptSends(failure('permanent', 'HTTP 422'));
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const { id } = (await (
      await pipeline.postFeedback(secretKey, { text: 'Fails then passes' })
    ).json()) as { id: string };
    const { deliveries } = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((delivery) => delivery.status === 'failed'),
    );
    const [delivery] = deliveries;

    const response = await member.post<DeliveryView>(`/api/deliveries/${delivery!.id}/replay`);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ id: delivery!.id, status: 'pending' });
    const after = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((d) => d.status === 'delivered'),
    );
    expect(after.deliveries).toHaveLength(1);
    expect(after.deliveries[0]).toMatchObject({
      id: delivery!.id,
      status: 'delivered',
      externalUrl: `https://destination.test/deliveries/${delivery!.id}`,
      attempts: 2,
      lastError: null,
    });
    expect(fake.attempts).toHaveLength(2);
    const detail = await member.get<FeedbackDetailView>(`/api/feedbacks/${id}`);
    expect(detail.body.deliveries[0]).toMatchObject({
      status: 'delivered',
      externalUrl: `https://destination.test/deliveries/${delivery!.id}`,
    });
  });

  it('replaying a delivered Delivery propagates the Verdict correction, without a second Delivery', async () => {
    const { feedback, fake } = await deliveredFeedback('Propagation');
    const [delivery] = feedback.deliveries;
    await member.patch(`/api/feedbacks/${feedback.id}/verdict`, { resolvedType: 'suggestion' });

    const response = await member.post(`/api/deliveries/${delivery!.id}/replay`);

    expect(response.status).toBe(202);
    await expect.poll(() => fake.deliveries.length).toBe(2);
    expect(fake.deliveries[1]?.feedback).toMatchObject({
      resolvedType: 'suggestion',
      severity: 'major',
    });
    const after = await pipeline.waitForFeedback(feedback.id, (r) =>
      r.deliveries.every((d) => d.status === 'delivered'),
    );
    expect(after.deliveries.map((d) => d.id)).toEqual([delivery!.id]);
    expect(after.deliveries[0]?.attempts).toBe(2);
  });

  it('two concurrent replays deliver only once more', async () => {
    const { feedback, fake } = await deliveredFeedback('Concurrent replays');
    const [delivery] = feedback.deliveries;
    // The winning replay stays in progress while the other one arrives.
    const release = fake.hold();

    const responses = await Promise.all([
      member.post(`/api/deliveries/${delivery!.id}/replay`),
      member.post(`/api/deliveries/${delivery!.id}/replay`),
    ]);
    release();

    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    await pipeline.waitForFeedback(feedback.id, (r) =>
      r.deliveries.every((d) => d.status === 'delivered'),
    );
    await letItRun();
    expect(fake.attempts).toHaveLength(2);
  });

  it('a pending Delivery cannot be replayed; an unknown Delivery is not found', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Not replayable',
    });
    const { fake } = await pipeline.createDestination(project.id);
    const release = fake.hold();
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const { id } = (await (
      await pipeline.postFeedback(secretKey, { text: 'Delivery in progress' })
    ).json()) as { id: string };
    await expect.poll(() => fake.attempts.length).toBe(1);
    const [delivery] = (await pipeline.readFeedback(id))!.deliveries;

    const pending = await member.post(`/api/deliveries/${delivery!.id}/replay`);
    const unknown = await member.post(
      '/api/deliveries/00000000-0000-4000-8000-000000000000/replay',
    );
    release();

    expect(pending).toMatchObject({
      status: 409,
      body: { error: 'delivery_not_replayable', status: 'pending' },
    });
    expect(unknown).toMatchObject({ status: 404, body: { error: 'delivery_not_found' } });
    await pipeline.waitForFeedback(id, (r) => r.deliveries.every((d) => d.status === 'delivered'));
    expect(fake.attempts).toHaveLength(1);
  });

  it('a Delivery held by its Suspended Destination cannot be replayed: the probe will release it', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Held',
    });
    const { fake } = await pipeline.createDestination(project.id);
    fake.scriptSends(failure('auth', 'HTTP 401'));
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const { id } = (await (
      await pipeline.postFeedback(secretKey, { text: 'Credentials refused' })
    ).json()) as { id: string };
    const { deliveries } = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((d) => d.status === 'held'),
    );

    const response = await member.post(`/api/deliveries/${deliveries[0]!.id}/replay`);

    expect(response).toMatchObject({
      status: 409,
      body: { error: 'delivery_not_replayable', status: 'held' },
    });
    await letItRun();
    expect(fake.attempts).toHaveLength(1);
  });
});
