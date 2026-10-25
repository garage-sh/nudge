import type { RedispatchView } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

/**
 * Redispatch (D22): a Member propagates a Verdict correction to the Destinations
 * whose Filter now accepts the Feedback, by creating the missing Deliveries;
 * existing Deliveries are never touched.
 */
describe('Redispatching a Feedback from the dashboard', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const post = async (secretKey: string, text: string) => {
    const response = await pipeline.postFeedback(secretKey, { text });
    return ((await response.json()) as { id: string }).id;
  };

  it('a Triaged Feedback no Filter accepted goes out after correction and becomes Dispatched', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Triaged without Delivery',
    });
    const { destination, fake } = await pipeline.createDestination(project.id, {
      filter: { types: ['bug'], minimumSeverity: 'major' },
    });
    pipeline.judge.script({ type: 'opinion', severity: 'cosmetic' });
    const id = await post(secretKey, 'Checkout crashes every time');
    await pipeline.waitForFeedback(id, (r) => r.state === 'triaged');
    await member.patch(`/api/feedbacks/${id}/verdict`, {
      resolvedType: 'bug',
      severity: 'blocking',
    });

    const response = await member.post<RedispatchView>(`/api/feedbacks/${id}/redispatch`);

    expect(response.status).toBe(200);
    expect(response.body.deliveriesCreated).toBe(1);
    expect(response.body.feedback).toMatchObject({
      state: 'dispatched',
      deliveries: [{ destination: { id: destination.id } }],
    });
    await pipeline.waitForFeedback(id, (r) => r.deliveries.every((d) => d.status === 'delivered'));
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0]?.feedback).toMatchObject({
      resolvedType: 'bug',
      severity: 'blocking',
    });
  });

  /** A Project with two Destinations: A accepts Bugs, B Suggestions. */
  const bugsAndSuggestionsProject = async (name: string) => {
    const { project, secretKey } = await pipeline.createProject({ name });
    const a = await pipeline.createDestination(project.id, {
      name: 'A',
      filter: { types: ['bug'], minimumSeverity: null },
    });
    const b = await pipeline.createDestination(project.id, {
      name: 'B',
      filter: { types: ['suggestion'], minimumSeverity: null },
    });
    return { secretKey, a, b };
  };

  /** A Bug Feedback dispatched and delivered to A only. */
  const bugDeliveredToA = async (name: string) => {
    const { secretKey, a, b } = await bugsAndSuggestionsProject(name);
    pipeline.judge.script({ type: 'bug', severity: 'minor' });
    const id = await post(secretKey, 'A dark mode would be nice');
    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((d) => d.status === 'delivered'),
    );
    return { id, feedback, a, b };
  };

  /** Gives the worker time to run, to observe that nothing happened. */
  const letItRun = () => new Promise((resolve) => setTimeout(resolve, 300));

  it('a Feedback Dispatched to A goes to B after correction, without changing anything for A', async () => {
    const { id, feedback, a, b } = await bugDeliveredToA('Dispatched to A');
    const [deliveryA] = feedback.deliveries;
    await member.patch(`/api/feedbacks/${id}/verdict`, { resolvedType: 'suggestion' });

    const response = await member.post<RedispatchView>(`/api/feedbacks/${id}/redispatch`);

    expect(response).toMatchObject({ status: 200, body: { deliveriesCreated: 1 } });
    const after = await pipeline.waitForFeedback(
      id,
      (r) => r.deliveries.length === 2 && r.deliveries.every((d) => d.status === 'delivered'),
    );
    expect(after.deliveries.find((d) => d.destinationId === a.destination.id)).toEqual(deliveryA);
    expect(a.fake.attempts).toHaveLength(1);
    expect(b.fake.deliveries).toHaveLength(1);
    expect(b.fake.deliveries[0]?.feedback).toMatchObject({ resolvedType: 'suggestion' });
  });

  it('a Suspended Destination gets its Delivery held, without an outgoing call', async () => {
    const { id, b } = await bugDeliveredToA('To a Suspended one');
    await pipeline.suspend(b.destination.id);
    await member.patch(`/api/feedbacks/${id}/verdict`, { resolvedType: 'suggestion' });

    const response = await member.post<RedispatchView>(`/api/feedbacks/${id}/redispatch`);

    expect(response).toMatchObject({ status: 200, body: { deliveriesCreated: 1 } });
    expect(
      response.body.feedback.deliveries.find((d) => d.destination.id === b.destination.id),
    ).toMatchObject({ status: 'held' });
    await letItRun();
    expect(b.fake.attempts).toHaveLength(0);
  });

  it('redispatching twice, or twice at the same time, creates only one Delivery per Destination', async () => {
    const { id, b } = await bugDeliveredToA('Idempotence');
    await member.patch(`/api/feedbacks/${id}/verdict`, { resolvedType: 'suggestion' });

    const concurrent = await Promise.all([
      member.post<RedispatchView>(`/api/feedbacks/${id}/redispatch`),
      member.post<RedispatchView>(`/api/feedbacks/${id}/redispatch`),
    ]);
    await pipeline.waitForFeedback(id, (r) => r.deliveries.every((d) => d.status === 'delivered'));
    const again = await member.post<RedispatchView>(`/api/feedbacks/${id}/redispatch`);

    expect(concurrent.map((r) => r.status)).toEqual([200, 200]);
    expect(concurrent.map((r) => r.body.deliveriesCreated).sort()).toEqual([0, 1]);
    expect(again).toMatchObject({ status: 200, body: { deliveriesCreated: 0 } });
    await letItRun();
    expect((await pipeline.readFeedback(id))?.deliveries).toHaveLength(2);
    expect(b.fake.attempts).toHaveLength(1);
  });

  it('a Feedback no additional Destination accepts stays as is', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Nothing more',
    });
    await pipeline.createDestination(project.id, {
      filter: { types: ['bug'], minimumSeverity: null },
    });
    pipeline.judge.script({ type: 'opinion', severity: 'minor' });
    const id = await post(secretKey, 'Nice website');
    await pipeline.waitForFeedback(id, (r) => r.state === 'triaged');

    const response = await member.post<RedispatchView>(`/api/feedbacks/${id}/redispatch`);

    expect(response).toMatchObject({
      status: 200,
      body: { deliveriesCreated: 0, feedback: { state: 'triaged', deliveries: [] } },
    });
  });

  it.each([
    ['Received', 'received'],
    ['Discarded', 'discarded'],
    ['In review', 'in_review'],
  ] as const)('refuses a %s Feedback, without creating a Delivery', async (_label, state) => {
    const { project, secretKey } = await pipeline.createProject({
      name: `Refusal ${state}`,
    });
    const { fake } = await pipeline.createDestination(project.id);
    let id: string;
    if (state === 'received') {
      id = await pipeline.insertFeedbackWithoutTriage(project.id, { text: 'Waiting' });
    } else {
      pipeline.judge.script(
        state === 'in_review'
          ? { type: 'bug', manipulation: 0.9, severity: 'blocking' }
          : { type: 'opinion', junk: 0.9, severity: 'cosmetic' },
      );
      id = await post(secretKey, `Feedback ${state}`);
      await pipeline.waitForFeedback(id, (r) => r.state === state);
    }

    const response = await member.post(`/api/feedbacks/${id}/redispatch`);

    expect(response).toMatchObject({
      status: 409,
      body: { error: 'feedback_not_redispatchable', state },
    });
    await letItRun();
    expect(await pipeline.readFeedback(id)).toMatchObject({ state, deliveries: [] });
    expect(fake.attempts).toHaveLength(0);
  });

  it('an unknown Feedback is not found, and a session is required', async () => {
    const unknown = await member.post(
      '/api/feedbacks/00000000-0000-4000-8000-000000000000/redispatch',
    );
    const notAnId = await member.post('/api/feedbacks/not-a-uuid/redispatch');
    const anonymous = await pipeline
      .dashboard()
      .post('/api/feedbacks/00000000-0000-4000-8000-000000000000/redispatch');

    expect(unknown).toMatchObject({ status: 404, body: { error: 'feedback_not_found' } });
    expect(notAnId).toMatchObject({ status: 404, body: { error: 'feedback_not_found' } });
    expect(anonymous).toMatchObject({ status: 401, body: { error: 'session_required' } });
  });
});
