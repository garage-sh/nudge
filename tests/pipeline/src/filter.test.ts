import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

/** A Triaged Feedback goes to each Destination whose Filter accepts it, and to them only. */
describe('Destination Filter', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  /** A Project with two Destinations: serious Bugs only, and Suggestions and Questions. */
  async function projectWithTwoDestinations(name: string) {
    const { project, secretKey } = await pipeline.createProject({ name });
    const seriousBugs = await pipeline.createDestination(project.id, {
      name: 'Serious bugs',
      filter: { types: ['bug'], minimumSeverity: 'major' },
    });
    const suggestions = await pipeline.createDestination(project.id, {
      name: 'Suggestions and Questions',
      filter: { types: ['suggestion', 'question'], minimumSeverity: null },
    });
    return { secretKey, seriousBugs, suggestions };
  }

  async function post(secretKey: string, text: string) {
    const response = await pipeline.postFeedback(secretKey, { text });
    return ((await response.json()) as { id: string }).id;
  }

  it('a blocking Bug goes to the serious Bugs Destination only', async () => {
    const { secretKey, seriousBugs, suggestions } = await projectWithTwoDestinations('Blocking');
    pipeline.judge.script({ type: 'bug', severity: 'blocking' });

    const id = await post(secretKey, 'Nobody can pay anymore');

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((d) => d.status === 'delivered'),
    );
    expect(feedback.state).toBe('dispatched');
    expect(feedback.deliveries.map((d) => d.destinationId)).toEqual([seriousBugs.destination.id]);
    expect(suggestions.fake.attempts).toHaveLength(0);
  });

  it('a Feedback goes to every Destination whose Filter accepts it, and is delivered there', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Several tools',
    });
    const seriousBugs = await pipeline.createDestination(project.id, {
      name: 'Serious bugs',
      filter: { types: ['bug'], minimumSeverity: 'major' },
    });
    const everything = await pipeline.createDestination(project.id, { name: 'Everything' });
    const suggestions = await pipeline.createDestination(project.id, {
      name: 'Suggestions',
      filter: { types: ['suggestion'], minimumSeverity: null },
    });
    pipeline.judge.script({ type: 'bug', severity: 'blocking' });

    const id = await post(secretKey, 'The site is unreachable');

    const feedback = await pipeline.waitForFeedback(
      id,
      (r) => r.deliveries.length === 2 && r.deliveries.every((d) => d.status === 'delivered'),
    );
    expect(feedback.state).toBe('dispatched');
    expect(feedback.deliveries.map((d) => d.destinationId).sort()).toEqual(
      [seriousBugs.destination.id, everything.destination.id].sort(),
    );
    for (const { fake } of [seriousBugs, everything]) {
      expect(fake.deliveries.map((delivery) => delivery.feedback.id)).toEqual([id]);
    }
    expect(suggestions.fake.attempts).toHaveLength(0);
  });

  it('the minimum Severity is an inclusive threshold', async () => {
    const { secretKey, seriousBugs } = await projectWithTwoDestinations('Threshold');
    pipeline.judge.script({ type: 'bug', severity: 'major' });

    const id = await post(secretKey, 'Payment fails one time out of two');

    const feedback = await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched');
    expect(feedback.deliveries.map((d) => d.destinationId)).toEqual([seriousBugs.destination.id]);
  });

  it('a Suggestion goes to the Destination that accepts its Type', async () => {
    const { secretKey, seriousBugs, suggestions } = await projectWithTwoDestinations('Suggestion');
    pipeline.judge.script({ type: 'suggestion', severity: 'blocking' });

    const id = await post(secretKey, 'A CSV export would be useful');

    const feedback = await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched');
    expect(feedback.deliveries.map((d) => d.destinationId)).toEqual([suggestions.destination.id]);
    expect(seriousBugs.fake.attempts).toHaveLength(0);
  });

  it('no Filter accepts the Feedback: it stays Triaged, without a Delivery', async () => {
    const { secretKey, seriousBugs, suggestions } = await projectWithTwoDestinations('Nobody');
    pipeline.judge.script({ type: 'bug', severity: 'minor' });

    const id = await post(secretKey, 'A typo in the footer');

    const feedback = await pipeline.waitForFeedback(id, (r) => r.verdict !== null);
    // Triage and Dispatch follow each other in the same job: nothing goes out afterwards.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await pipeline.readFeedback(id)).toMatchObject({ state: 'triaged', deliveries: [] });
    expect(feedback.verdict).toMatchObject({ resolvedType: 'bug', severity: 'minor' });
    expect(seriousBugs.fake.attempts).toHaveLength(0);
    expect(suggestions.fake.attempts).toHaveLength(0);
  });

  it('a Filter changed from the dashboard applies to the next Feedback', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Changed filter',
    });
    const member = await pipeline.signIn();
    const creation = await member.post<{ destination: { id: string } }>(
      `/api/projects/${project.id}/destinations`,
      {
        type: 'webhook',
        name: 'Opinions only',
        config: { url: 'https://receiver.test/opinions' },
        filter: { types: ['opinion'], minimumSeverity: null },
      },
    );
    const destinationId = creation.body.destination.id;
    const update = await member.patch(`/api/destinations/${destinationId}`, {
      filter: { types: ['bug'], minimumSeverity: 'minor' },
    });
    expect(update.status).toBe(200);
    pipeline.judge.script({ type: 'bug', severity: 'minor' });

    const id = await post(secretKey, 'The Back button does nothing');

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((d) => d.status === 'delivered'),
    );
    expect(feedback.deliveries.map((d) => d.destinationId)).toEqual([destinationId]);
    expect(pipeline.fakeDestination(destinationId).deliveries).toHaveLength(1);
  });
});

describe('Filter in degraded mode, without a Judge', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({ judge: null });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('a Feedback without a Severity reaches no minimum Severity', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Degraded',
    });
    const demanding = await pipeline.createDestination(project.id, {
      filter: { types: ['bug'], minimumSeverity: 'cosmetic' },
    });
    const noSeverity = await pipeline.createDestination(project.id, {
      filter: { types: ['bug'], minimumSeverity: null },
    });

    const response = await pipeline.postFeedback(secretKey, { text: 'It crashes', type: 'bug' });
    const { id } = (await response.json()) as { id: string };

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((d) => d.status === 'delivered'),
    );
    expect(feedback.verdict).toMatchObject({ resolvedType: 'bug', severity: null });
    expect(feedback.deliveries.map((d) => d.destinationId)).toEqual([noSeverity.destination.id]);
    expect(demanding.fake.attempts).toHaveLength(0);
  });
});
