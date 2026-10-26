import type { CaptureStorage } from '@nudge/storage';
import {
  CAPTURE_MAX_BYTES,
  captureUrl,
  type ApiErrorBody,
  type FeedbackPage,
  type FeedbackDetailView,
} from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const ORIGIN = 'https://shop.example';

/** A 1 × 1 pixel PNG image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_SIGNATURE = PNG.subarray(0, 8);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const pngCapture = { contentType: 'image/png', data: PNG.toString('base64') } as const;

describe('Captures', () => {
  let pipeline: Pipeline;
  let publicKey: string;
  let secretKey: string;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    ({ publicKey, secretKey } = await pipeline.createProject({
      name: 'Shop',
      allowedOrigins: [ORIGIN],
    }));
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function postWithCapture(text: string, capture: object = pngCapture) {
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, { text, capture });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    return id;
  }

  it('stores the Capture attached by the Widget and shows it to the Member, byte for byte', async () => {
    const id = await postWithCapture('The cart overflows the screen');

    const detail = await member.get<FeedbackDetailView>(`/api/feedbacks/${id}`);
    expect(detail.body.capture).toEqual({ contentType: 'image/png', bytes: PNG.length });
    const image = await member.download(captureUrl(id));
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(image.bytes).toEqual(new Uint8Array(PNG));
  });

  it('also accepts a Capture posted with the secret key', async () => {
    const response = await pipeline.postFeedback(secretKey, {
      text: 'Capture sent by the backend',
      capture: { contentType: 'image/jpeg', data: JPEG_SIGNATURE.toString('base64') },
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };

    expect((await member.get<FeedbackDetailView>(`/api/feedbacks/${id}`)).body.capture).toEqual({
      contentType: 'image/jpeg',
      bytes: JPEG_SIGNATURE.length,
    });
  });

  it('a Feedback without a Capture shows none', async () => {
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, { text: 'No image' });
    const { id } = (await response.json()) as { id: string };

    expect((await member.get<FeedbackDetailView>(`/api/feedbacks/${id}`)).body.capture).toBeNull();
    const image = await member.download(captureUrl(id));
    expect(image.status).toBe(404);
    expect(image.json<ApiErrorBody>()).toEqual({ error: 'capture_not_found' });
  });

  it('shows the Capture only to a signed-in Member', async () => {
    const id = await postWithCapture('Members only');

    expect((await pipeline.dashboard().download(captureUrl(id))).status).toBe(401);
  });

  it('never sends the Capture to the Judge', async () => {
    const text = 'The logo is pixelated on mobile';
    const id = await postWithCapture(text);
    await pipeline.waitForFeedback(id, (feedback) => feedback.state !== 'received');

    const requests = pipeline.judge.requests.filter((request) => request.state.text === text);
    expect(requests).toHaveLength(1);
    const raw = JSON.stringify(requests);
    expect(raw).not.toContain(pngCapture.data);
    expect(raw).not.toMatch(/capture/i);
  });

  it('attaches the Capture to each Delivery, and nothing to a Feedback that has none', async () => {
    const { project, publicKey: key } = await pipeline.createProject({
      name: 'Capture dispatch',
      allowedOrigins: [ORIGIN],
    });
    const { fake } = await pipeline.createDestination(project.id);
    const withCapture = (await (
      await pipeline.postWidgetFeedback(key, ORIGIN, { text: 'With Capture', capture: pngCapture })
    ).json()) as { id: string };
    const withoutCapture = (await (
      await pipeline.postWidgetFeedback(key, ORIGIN, { text: 'Without Capture' })
    ).json()) as { id: string };
    await pipeline.waitForFeedback(withCapture.id, (feedback) => feedback.state === 'dispatched');
    await pipeline.waitForFeedback(
      withoutCapture.id,
      (feedback) => feedback.state === 'dispatched',
    );
    await expect.poll(() => fake.deliveries.length).toBe(2);

    const deliveryWith = fake.deliveries.find((d) => d.feedback.id === withCapture.id)!;
    const deliveryWithout = fake.deliveries.find((d) => d.feedback.id === withoutCapture.id)!;
    expect(deliveryWith.feedback.capture).toMatchObject({
      contentType: 'image/png',
      bytes: PNG.length,
    });
    expect(await deliveryWith.feedback.capture!.read()).toEqual(new Uint8Array(PNG));
    expect(deliveryWithout.feedback.capture).toBeNull();
  });

  it.each([
    ['an unsupported format', { contentType: 'image/gif', data: 'R0lGODlhAQABAAAAACw=' }],
    [
      'a declared PNG that is not one',
      { contentType: 'image/png', data: JPEG_SIGNATURE.toString('base64') },
    ],
    [
      'HTML disguised as an image',
      {
        contentType: 'image/png',
        data: Buffer.from('<script>alert(1)</script>').toString('base64'),
      },
    ],
    ['content that is not base64', { contentType: 'image/png', data: 'not base64 at all' }],
    ['an empty Capture', { contentType: 'image/png', data: '' }],
    [
      'a too heavy Capture',
      {
        contentType: 'image/png',
        data: Buffer.concat([PNG_SIGNATURE, Buffer.alloc(CAPTURE_MAX_BYTES)]).toString('base64'),
      },
    ],
  ])('refuses %s, without recording anything', async (_case, capture) => {
    const text = `Capture refused ${crypto.randomUUID()}`;
    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, { text, capture });

    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error).toBe('invalid_feedback');
    expect(body.details?.every((detail) => detail.path.startsWith('capture'))).toBe(true);
    const page = await member.get<FeedbackPage>('/api/feedbacks?limit=100');
    expect(page.body.feedbacks.some((feedback) => feedback.preview === text)).toBe(false);
  });
});

describe('Captures, storage unavailable', () => {
  let pipeline: Pipeline;

  const brokenStorage: CaptureStorage = {
    save: () => Promise.reject(new Error('disk full')),
    read: () => Promise.reject(new Error('disk unreadable')),
    delete: () => Promise.resolve(),
    // eslint-disable-next-line require-yield
    list: async function* () {
      throw new Error('disk unreadable');
    },
    removeIncomplete: () => Promise.resolve(0),
  };

  beforeAll(async () => {
    pipeline = await startPipeline({ storage: brokenStorage });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('refuses the Feedback rather than silently losing its Capture', async () => {
    const { project, publicKey } = await pipeline.createProject({
      name: 'Broken storage',
      allowedOrigins: [ORIGIN],
    });

    const response = await pipeline.postWidgetFeedback(publicKey, ORIGIN, {
      text: 'My Capture will not be lost',
      capture: pngCapture,
    });

    expect(response.status).toBe(500);
    const member = await pipeline.signIn();
    const page = await member.get<FeedbackPage>(`/api/feedbacks?project=${project.id}`);
    expect(page.body.feedbacks).toEqual([]);
  });
});
