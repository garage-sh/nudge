import type { DestinationWithGeneratedSecrets } from '@nudge/shared';
import type { CaptureStorage } from '@nudge/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { failure, WebhookReceiver, startPipeline, type Pipeline } from './harness/index.js';

/**
 * Delivery failures and Suspension of a Destination (shape borrowed from what
 * alliances-pa documents for its workers): a transient failure is retried and counts toward Suspension, an
 * auth failure suspends without retry, a permanent failure only fails the Delivery. A
 * Suspended Destination holds its Deliveries without any outgoing call, until a
 * probe finds it reachable.
 */
describe('Delivery failures and Destination Suspension', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({
      suspension: { failureThreshold: 3, cooldownMs: 300, probeIntervalMs: 100 },
      workerReplicas: 2,
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function projectWithDestination(name: string) {
    const { project, secretKey } = await pipeline.createProject({ name });
    const { destination, fake } = await pipeline.createDestination(project.id);
    const post = async (text: string) => {
      pipeline.judge.script({ type: 'bug', severity: 'major' });
      const response = await pipeline.postFeedback(secretKey, { text });
      return ((await response.json()) as { id: string }).id;
    };
    return { project, destination, fake, post };
  }

  const destinationState = async (id: string) => (await pipeline.destinationRow(id))?.state;

  it('auth failure: the Destination is Suspended at once, without retry, and the Delivery is held', async () => {
    const { destination, fake, post } = await projectWithDestination('Revoked token');
    fake.scriptSends(failure('auth', 'HTTP 401: token refused'));
    fake.scriptHealth({ reachable: false, failureClass: 'auth', message: 'HTTP 401' });

    const id = await post('Checkout fails');

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((e) => e.status === 'held'),
    );
    expect(feedback.deliveries).toMatchObject([
      { status: 'held', attempts: 1, lastError: 'auth: HTTP 401: token refused' },
    ]);
    expect(await destinationState(destination.id)).toBe('suspended');
    expect(fake.attempts).toHaveLength(1);
    expect(pipeline.suspensions).toEqual([
      {
        destinationId: destination.id,
        projectId: destination.projectId,
        name: destination.name,
        failureClass: 'auth',
        message: 'HTTP 401: token refused',
        suspendedAt: expect.any(Date),
      },
    ]);
  });

  it('permanent failure: the Delivery fails, without retry, and the Destination stays active', async () => {
    const { destination, fake, post } = await projectWithDestination('Refused request');
    fake.scriptSends(failure('permanent', 'HTTP 422: title too long'));

    const id = await post('A text the Destination refuses');

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((e) => e.status === 'failed'),
    );
    expect(feedback.deliveries).toMatchObject([
      { status: 'failed', attempts: 1, lastError: 'permanent: HTTP 422: title too long' },
    ]);
    // The job is not retried: a single call, even after the backoff.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.attempts).toHaveLength(1);
    expect(await destinationState(destination.id)).toBe('active');
    expect(pipeline.suspensions.map((s) => s.destinationId)).not.toContain(destination.id);
  });

  it('transient failure: retried with backoff, then delivered; a delivery resets the streak', async () => {
    const { destination, fake, post } = await projectWithDestination('Flaky destination');
    fake.scriptSends(failure('transient', 'HTTP 503'), failure('transient', 'HTTP 429'));

    const first = await post('First feedback');
    const delivered = await pipeline.waitForFeedback(first, (r) =>
      r.deliveries.some((e) => e.status === 'delivered'),
    );
    expect(delivered.deliveries).toMatchObject([
      { status: 'delivered', attempts: 3, lastError: null },
    ]);

    // Two new failures: without a reset, the streak would reach the threshold (3).
    fake.scriptSends(failure('transient', 'HTTP 502'), failure('transient', 'HTTP 504'));
    const second = await post('Second feedback');
    await pipeline.waitForFeedback(second, (r) =>
      r.deliveries.some((e) => e.status === 'delivered'),
    );
    expect(fake.attempts).toHaveLength(6);
    expect(await destinationState(destination.id)).toBe('active');
  });

  it('at the consecutive transient failure threshold, the Destination is Suspended and its new Deliveries are held without any outgoing call', async () => {
    const { destination, fake, post } = await projectWithDestination('Destination down');
    fake.scriptSends(...Array.from({ length: 3 }, () => failure('transient', 'HTTP 503')));
    fake.scriptHealth(
      ...Array.from({ length: 50 }, () => ({
        reachable: false as const,
        failureClass: 'transient' as const,
        message: 'HTTP 503',
      })),
    );

    const first = await post('Before the outage');
    const held = await pipeline.waitForFeedback(first, (r) =>
      r.deliveries.some((e) => e.status === 'held'),
    );
    expect(held.deliveries).toMatchObject([
      { status: 'held', attempts: 3, lastError: 'transient: HTTP 503' },
    ]);
    expect(await destinationState(destination.id)).toBe('suspended');
    expect(pipeline.suspensions).toContainEqual(
      expect.objectContaining({ destinationId: destination.id, failureClass: 'transient' }),
    );

    const second = await post('During the outage');
    const fresh = await pipeline.waitForFeedback(second, (r) => r.deliveries.length > 0);
    expect(fresh).toMatchObject({
      state: 'dispatched',
      deliveries: [{ status: 'held', attempts: 0 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.attempts).toHaveLength(3);
  });

  it('after the cooldown, the probe tests the Destination: unreachable, it stays Suspended; reachable, it becomes active again and its held Deliveries resume', async () => {
    const { destination, fake, post } = await projectWithDestination('Outage then recovery');
    fake.scriptSends(failure('auth', 'HTTP 403'));
    // Unreachable until the test restores it: the second Feedback arrives during the
    // Suspension, however long its triage takes under load.
    fake.scriptHealth(
      ...Array.from({ length: 50 }, () => ({
        reachable: false as const,
        failureClass: 'auth' as const,
        message: 'HTTP 403',
      })),
    );

    const first = await post('Held by the Suspension');
    await pipeline.waitForFeedback(first, (r) => r.deliveries.some((e) => e.status === 'held'));
    const second = await post('Arrived during the Suspension');
    const held = await pipeline.waitForFeedback(second, (r) =>
      r.deliveries.some((e) => e.status === 'held'),
    );
    expect(held.deliveries).toMatchObject([{ status: 'held', attempts: 0 }]);

    // First probe: not before the end of the cooldown (300 ms), counted from the failure
    // that suspended the Destination (measured by the clock, not by the test's progress),
    // and still refused.
    await expect.poll(() => fake.healthChecks, { timeout: 2000 }).toBeGreaterThan(0);
    expect(fake.healthCheckTimes[0]! - fake.attemptTimes[0]!).toBeGreaterThanOrEqual(300);
    expect(await destinationState(destination.id)).toBe('suspended');

    // The Destination answers again: a single extra probe reactivates it.
    fake.restoreHealth();
    const refusedProbes = fake.healthChecks;
    for (const id of [first, second]) {
      const feedback = await pipeline.waitForFeedback(
        id,
        (r) => r.deliveries.some((e) => e.status === 'delivered'),
        5000,
      );
      expect(feedback.deliveries).toMatchObject([{ status: 'delivered', lastError: null }]);
    }
    expect(fake.healthChecks).toBe(refusedProbes + 1);
    expect(await destinationState(destination.id)).toBe('active');
    expect(fake.deliveries.map((e) => e.feedback.id).sort()).toEqual([first, second].sort());
  });

  it('concurrent auth failures on two worker replicas suspend the Destination only once', async () => {
    const { destination, fake, post } = await projectWithDestination('Concurrent failures');
    fake.scriptSends(failure('auth', 'HTTP 401'), failure('auth', 'HTTP 401'));
    fake.scriptHealth(
      ...Array.from({ length: 50 }, () => ({
        reachable: false as const,
        failureClass: 'auth' as const,
        message: 'HTTP 401',
      })),
    );
    const release = fake.hold();

    const ids = await Promise.all([post('Concurrent feedback 1'), post('Concurrent feedback 2')]);
    // Both Deliveries are in flight at the same time, one per replica.
    await expect.poll(() => fake.attempts.length, { timeout: 5000 }).toBe(2);
    release();

    for (const id of ids) {
      await pipeline.waitForFeedback(id, (r) => r.deliveries.some((e) => e.status === 'held'));
    }
    expect(pipeline.suspensions.filter((s) => s.destinationId === destination.id)).toHaveLength(1);
  });

  it('an interrupted release (Destination reactivated, Deliveries never re-enqueued) is caught up by the probe', async () => {
    const { destination, fake, post } = await projectWithDestination('Interrupted release');
    fake.scriptSends(failure('auth', 'HTTP 401'));
    fake.scriptHealth(
      ...Array.from({ length: 50 }, () => ({
        reachable: false as const,
        failureClass: 'auth' as const,
        message: 'HTTP 401',
      })),
    );
    const id = await post('Held then forgotten');
    await pipeline.waitForFeedback(id, (r) => r.deliveries.some((e) => e.status === 'held'));

    // Like a worker stopped right after reactivating the Destination.
    await pipeline.reactivateWithoutReleasing(destination.id);

    const feedback = await pipeline.waitForFeedback(id, (r) =>
      r.deliveries.some((e) => e.status === 'delivered'),
    );
    expect(feedback.deliveries).toMatchObject([{ status: 'delivered', attempts: 2 }]);
    expect(fake.deliveries).toHaveLength(1);
  });
});

describe('Transient failures below the Suspension threshold', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    // Threshold out of reach: the job's 8 attempts run out before the Suspension.
    pipeline = await startPipeline({
      suspension: { failureThreshold: 100, cooldownMs: 300, probeIntervalMs: 100 },
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('a Delivery whose attempts run out becomes failed instead of staying pending', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Attempts exhausted',
    });
    const { destination, fake } = await pipeline.createDestination(project.id);
    fake.scriptSends(...Array.from({ length: 8 }, () => failure('transient', 'HTTP 503')));
    pipeline.judge.script({ type: 'bug', severity: 'major' });

    const response = await pipeline.postFeedback(secretKey, { text: 'Never delivered' });
    const { id } = (await response.json()) as { id: string };

    const feedback = await pipeline.waitForFeedback(
      id,
      (r) => r.deliveries.some((e) => e.status === 'failed'),
      10_000,
    );
    expect(feedback.deliveries).toMatchObject([
      { status: 'failed', attempts: 8, lastError: 'transient: HTTP 503' },
    ]);
    expect(fake.attempts).toHaveLength(8);
    expect((await pipeline.destinationRow(destination.id))?.state).toBe('active');
  });
});

/**
 * A failure that comes from nudge and not from the target (D25) is retried, but says
 * nothing about the Destination: it does not count toward its Suspension and triggers no alert.
 */
describe('Failures internal to nudge', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({
      suspension: { failureThreshold: 2, cooldownMs: 300, probeIntervalMs: 100 },
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function post(secretKey: string, text: string) {
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const response = await pipeline.postFeedback(secretKey, { text });
    return ((await response.json()) as { id: string }).id;
  }

  it('an unexpected exception from the adapter is retried without suspending the Destination', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Buggy adapter',
    });
    const { destination, fake } = await pipeline.createDestination(project.id);
    fake.scriptSends(...Array.from({ length: 8 }, () => new Error('nudge bug')));

    const id = await post(secretKey, 'The bug is on our side');

    const feedback = await pipeline.waitForFeedback(
      id,
      (r) => r.deliveries.some((e) => e.status === 'failed'),
      10_000,
    );
    expect(feedback.deliveries).toMatchObject([{ status: 'failed', attempts: 8 }]);
    expect(fake.attempts).toHaveLength(8);
    expect((await pipeline.destinationRow(destination.id))?.state).toBe('active');
    expect(pipeline.suspensions).toEqual([]);
  });

  it('undecryptable secrets are retried without suspending the Destination nor calling it', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Changed Instance key',
    });
    const { destination, fake } = await pipeline.createDestination(project.id);
    await pipeline.makeSecretsUndecryptable(destination.id);

    const id = await post(secretKey, 'The secrets are lost');

    const feedback = await pipeline.waitForFeedback(
      id,
      (r) => r.deliveries.some((e) => e.status === 'failed'),
      10_000,
    );
    expect(feedback.deliveries).toMatchObject([{ status: 'failed', attempts: 8 }]);
    expect(fake.attempts).toHaveLength(0);
    expect((await pipeline.destinationRow(destination.id))?.state).toBe('active');
    expect(pipeline.suspensions).toEqual([]);
  });
});

describe('Failures internal to nudge: Capture unreadable in storage', () => {
  let pipeline: Pipeline;
  let receiver: WebhookReceiver;

  const unreadableStorage: CaptureStorage = {
    save: () => Promise.resolve(),
    read: () => Promise.reject(new Error('unreadable disk')),
    delete: () => Promise.resolve(),
    // eslint-disable-next-line require-yield
    list: async function* () {
      throw new Error('unreadable disk');
    },
    removeIncomplete: () => Promise.resolve(0),
  };

  beforeAll(async () => {
    [pipeline, receiver] = await Promise.all([
      startPipeline({
        destinations: 'real',
        storage: unreadableStorage,
        suspension: { failureThreshold: 2, cooldownMs: 300, probeIntervalMs: 100 },
      }),
      WebhookReceiver.start(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([pipeline?.stop(), receiver?.stop()]);
  });

  it('a webhook whose Capture cannot be read is retried without being suspended', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Unreadable storage',
    });
    const member = await pipeline.signIn();
    const creation = await member.post<DestinationWithGeneratedSecrets>(
      `/api/projects/${project.id}/destinations`,
      { type: 'webhook', name: 'Local receiver', config: { url: `${receiver.url}/capture` } },
    );
    expect(creation.status).toBe(201);
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2a, 0x2a]);

    const response = await pipeline.postFeedback(secretKey, {
      text: 'See the capture',
      capture: { contentType: 'image/png', data: png.toString('base64') },
    });
    const { id } = (await response.json()) as { id: string };

    const feedback = await pipeline.waitForFeedback(
      id,
      (r) => r.deliveries.some((e) => e.status === 'failed'),
      10_000,
    );
    expect(feedback.deliveries).toMatchObject([
      { status: 'failed', attempts: 8, lastError: expect.stringContaining('Capture') },
    ]);
    expect((await pipeline.destinationRow(creation.body.destination.id))?.state).toBe('active');
    expect(pipeline.suspensions).toEqual([]);
    expect(receiver.requests.filter((r) => r.path === '/capture')).toEqual([]);
  });
});
