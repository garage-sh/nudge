import { captureUrl, type ApiErrorBody, type FeedbackPage } from '@nudge/shared';
import type { CaptureStorage } from '@nudge/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const ORIGIN = 'https://shop.example';

/** A 1 × 1 pixel PNG image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const capturePng = { contentType: 'image/png', data: PNG.toString('base64') } as const;

/**
 * In-memory Capture storage: the test sees the objects it keeps, as a
 * self-hoster would see the files of their volume.
 */
function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage: CaptureStorage = {
    save: async (key, content) => {
      objects.set(key, content);
    },
    read: async (key) => objects.get(key) ?? null,
    delete: async (key) => {
      objects.delete(key);
    },
  };
  /** The storage objects that belong to Feedback `id` (its key names it). */
  const objectsOf = (id: string) => [...objects.keys()].filter((key) => key.includes(id));
  return { storage, objectsOf };
}

/** The Feedback's Capture as the Member downloads it: 200 as long as it exists. */
const captureStatus = (member: DashboardClient, id: string) =>
  member.download(captureUrl(id)).then((response) => response.status);

describe('Deletion of a Feedback', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;
  let publicKey: string;
  let projectId: string;
  const { storage, objectsOf } = memoryStorage();

  beforeAll(async () => {
    pipeline = await startPipeline({ storage });
    const created = await pipeline.createProject({ name: 'Erasure', allowedOrigins: [ORIGIN] });
    ({ publicKey } = created);
    projectId = created.project.id;
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function postWithCapture(text: string) {
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
      text,
      capture: capturePng,
    });
    expect(response.status).toBe(202);
    return ((await response.json()) as { id: string }).id;
  }

  it('deletes the Feedback and its Capture, from the dashboard and from storage', async () => {
    const text = 'Please erase my Feedback';
    const id = await postWithCapture(text);
    await pipeline.waitForFeedback(id, (feedback) => feedback.state !== 'received');
    expect(await captureStatus(member, id)).toBe(200);
    expect(objectsOf(id)).toHaveLength(1);

    const deletion = await member.delete(`/api/feedbacks/${id}`);

    expect(deletion.status).toBe(204);
    expect((await member.get<ApiErrorBody>(`/api/feedbacks/${id}`)).status).toBe(404);
    expect(await captureStatus(member, id)).toBe(404);
    const page = await member.get<FeedbackPage>(`/api/feedbacks?project=${projectId}`);
    expect(page.body.feedbacks.some((feedback) => feedback.preview === text)).toBe(false);
    // The image itself has left the storage, not only its reference in the database.
    expect(objectsOf(id)).toEqual([]);
  });

  it('also deletes a Feedback without a Capture, and its Deliveries', async () => {
    const { fake } = await pipeline.createDestination(projectId);
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, { text: 'No image' });
    const { id } = (await response.json()) as { id: string };
    await pipeline.waitForFeedback(id, (feedback) =>
      feedback.deliveries.some((d) => d.status === 'delivered'),
    );

    expect((await member.delete(`/api/feedbacks/${id}`)).status).toBe(204);

    expect(await pipeline.readFeedback(id)).toBeNull();
    expect(fake.deliveries.filter((delivery) => delivery.feedback.id === id)).toHaveLength(1);
  });

  it('returns 404 for an unknown or already deleted Feedback', async () => {
    const id = await postWithCapture('Deleted twice');
    expect((await member.delete(`/api/feedbacks/${id}`)).status).toBe(204);

    const second = await member.delete<ApiErrorBody>(`/api/feedbacks/${id}`);
    expect(second).toEqual({ status: 404, body: { error: 'feedback_not_found' } });
    expect((await member.delete('/api/feedbacks/not-a-uuid')).status).toBe(404);
  });

  it('is reserved for a signed-in Member', async () => {
    const id = await postWithCapture('Hands off');

    expect((await pipeline.dashboard().delete(`/api/feedbacks/${id}`)).status).toBe(401);
    expect((await member.get(`/api/feedbacks/${id}`)).status).toBe(200);
    expect(objectsOf(id)).toHaveLength(1);
  });
});

describe('Deletion of a Feedback, storage unavailable', () => {
  let pipeline: Pipeline;
  let down = false;
  const memory = memoryStorage();
  const storage: CaptureStorage = {
    ...memory.storage,
    delete: (key) =>
      down ? Promise.reject(new Error('storage unreachable')) : memory.storage.delete(key),
  };

  beforeAll(async () => {
    pipeline = await startPipeline({ storage });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('keeps the Feedback until its Capture is erased, and the deletion can be retried', async () => {
    const { publicKey } = await pipeline.createProject({
      name: 'Flaky storage',
      allowedOrigins: [ORIGIN],
    });
    const member = await pipeline.signIn();
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
      text: 'Erasure to retry',
      capture: capturePng,
    });
    const { id } = (await response.json()) as { id: string };
    down = true;

    const refusal = await member.delete<ApiErrorBody>(`/api/feedbacks/${id}`);

    expect(refusal).toEqual({ status: 503, body: { error: 'storage_unavailable' } });
    expect((await member.get(`/api/feedbacks/${id}`)).status).toBe(200);
    expect(await captureStatus(member, id)).toBe(200);

    down = false;
    expect((await member.delete(`/api/feedbacks/${id}`)).status).toBe(204);
    expect(memory.objectsOf(id)).toEqual([]);
  });
});

describe('Feedback Retention', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;
  const { storage, objectsOf } = memoryStorage();

  beforeAll(async () => {
    pipeline = await startPipeline({ storage, purge: { intervalMs: 100 } });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('unlimited by default: an old Feedback stays', async () => {
    expect(await member.get('/api/instance/retention')).toEqual({
      status: 200,
      body: { days: null },
    });
    const { publicKey } = await pipeline.createProject({
      name: 'No retention',
      allowedOrigins: [ORIGIN],
    });
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
      text: 'Old but kept',
      capture: capturePng,
    });
    const { id } = (await response.json()) as { id: string };
    await pipeline.ageFeedback(id, 3650);

    // Several purge passes: nothing moves.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await member.get(`/api/feedbacks/${id}`)).status).toBe(200);
    expect(objectsOf(id)).toHaveLength(1);
  });

  it('purges Feedback older than the chosen duration, with their Captures', async () => {
    const { project, publicKey } = await pipeline.createProject({
      name: '30-day retention',
      allowedOrigins: [ORIGIN],
    });
    await pipeline.createDestination(project.id);
    const post = async (text: string) => {
      const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
        text,
        capture: capturePng,
      });
      const { id } = (await response.json()) as { id: string };
      await pipeline.waitForFeedback(id, (r) => r.deliveries.some((d) => d.status === 'delivered'));
      return id;
    };
    const expired = await post('Thirty-one days');
    const recent = await post('Twenty-nine days');
    const fresh = await post('Today');
    await pipeline.ageFeedback(expired, 31);
    await pipeline.ageFeedback(recent, 29);

    const setting = await member.put('/api/instance/retention', { days: 30 });
    expect(setting).toEqual({ status: 200, body: { days: 30 } });
    expect((await member.get('/api/instance/retention')).body).toEqual({ days: 30 });

    await expect
      .poll(async () => (await member.get(`/api/feedbacks/${expired}`)).status, { timeout: 5000 })
      .toBe(404);
    expect(objectsOf(expired)).toEqual([]);
    for (const kept of [recent, fresh]) {
      expect((await member.get(`/api/feedbacks/${kept}`)).status).toBe(200);
      expect(objectsOf(kept)).toHaveLength(1);
    }
  });

  it('refuses a duration that is not a positive whole number of days', async () => {
    for (const days of [0, -1, 1.5, '30', 36_501]) {
      const refusal = await member.put<ApiErrorBody>('/api/instance/retention', { days });
      expect(refusal.status).toBe(400);
      expect(refusal.body.error).toBe('invalid_request');
    }
    expect((await pipeline.dashboard().put('/api/instance/retention', { days: 1 })).status).toBe(
      401,
    );
  });

  it('goes back to unlimited retention', async () => {
    expect(await member.put('/api/instance/retention', { days: null })).toEqual({
      status: 200,
      body: { days: null },
    });
    expect((await member.get('/api/instance/retention')).body).toEqual({ days: null });
  });
});

describe('Feedback Retention, flaky storage', () => {
  let pipeline: Pipeline;
  const memory = memoryStorage();
  /** Keys the storage refuses to erase. */
  const refused = new Set<string>();
  const storage: CaptureStorage = {
    ...memory.storage,
    delete: (key) =>
      refused.has(key) ? Promise.reject(new Error('object locked')) : memory.storage.delete(key),
  };

  beforeAll(async () => {
    pipeline = await startPipeline({ storage, purge: { intervalMs: 100 } });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('keeps the Feedback whose Capture resists, purges the others, and purges it once it gives way', async () => {
    const member = await pipeline.signIn();
    const { publicKey } = await pipeline.createProject({
      name: 'Partial purge',
      allowedOrigins: [ORIGIN],
    });
    const post = async (text: string) => {
      const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
        text,
        capture: capturePng,
      });
      const { id } = (await response.json()) as { id: string };
      await pipeline.waitForFeedback(id, (r) => r.state !== 'received');
      return id;
    };
    // The oldest resists: it must not block the purge of the next ones.
    const resistant = await post('Locked Capture');
    const purgeable = await post('Erasable Capture');
    await pipeline.ageFeedback(resistant, 40);
    await pipeline.ageFeedback(purgeable, 35);
    for (const key of memory.objectsOf(resistant)) refused.add(key);

    await member.put('/api/instance/retention', { days: 30 });

    await expect
      .poll(async () => (await member.get(`/api/feedbacks/${purgeable}`)).status, { timeout: 5000 })
      .toBe(404);
    expect(memory.objectsOf(purgeable)).toEqual([]);
    expect((await member.get(`/api/feedbacks/${resistant}`)).status).toBe(200);
    expect(await captureStatus(member, resistant)).toBe(200);

    refused.clear();
    await expect
      .poll(async () => (await member.get(`/api/feedbacks/${resistant}`)).status, { timeout: 5000 })
      .toBe(404);
    expect(memory.objectsOf(resistant)).toEqual([]);
  });
});
