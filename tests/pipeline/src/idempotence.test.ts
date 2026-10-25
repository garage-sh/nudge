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
