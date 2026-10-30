import type { ConfiguredDestination, OutgoingDelivery } from '@nudge/core';
import { describe, expect, it, vi } from 'vitest';
import { resolveDestinationAdapter } from './index.js';
import { telegramAdapter } from './telegram.js';
import { HELD_SUMMARY, IN_REVIEW_ALERT, SUSPENSION_ALERT } from './test/alerts.js';
import { incidentClosing, incidentOpenedThenClosed, incidentOpening } from './test/incidents.js';
import {
  BOT_TOKEN,
  MESSAGE_ID,
  SUPERGROUP_ID,
  TELEGRAM,
  type Recording,
} from './test/telegram-recordings.js';

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const SUPERGROUP_LINK = `https://t.me/c/1234567890/${MESSAGE_ID}`;

const DESTINATION: ConfiguredDestination = {
  id: '6f1c2a40-0000-4000-8000-000000000021',
  projectId: '6f1c2a40-0000-4000-8000-000000000022',
  name: 'Telegram Shop bugs',
  type: 'telegram',
  config: { chatId: String(SUPERGROUP_ID), topicId: null },
  secrets: { botToken: BOT_TOKEN },
};

const IN_TOPIC: ConfiguredDestination = {
  ...DESTINATION,
  config: { chatId: String(SUPERGROUP_ID), topicId: 42 },
};

const DELIVERY: OutgoingDelivery = {
  deliveryId: '6f1c2a40-0000-4000-8000-000000000023',
  isTest: false,
  project: { id: DESTINATION.projectId!, name: 'Shop <Web>' },
  feedback: {
    id: '6f1c2a40-0000-4000-8000-000000000024',
    text: 'The cart empties when I change pages. <b>Really</b> & @support',
    source: 'widget',
    resolvedType: 'bug',
    severity: 'major',
    uncertain: false,
    author: { id: 'u-42', email: 'ada@client.test', name: 'Ada', trust: 'attested' },
    context: { url: 'https://shop.test/cart' },
    capture: null,
    receivedAt: new Date('2026-10-24T09:29:58.000Z'),
    dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000024',
  },
};

interface ReceivedRequest {
  readonly url: string;
  readonly init: RequestInit;
  /** The JSON body; `null` for a multipart body (`form`). */
  readonly json: Record<string, unknown> | null;
  readonly form: FormData | null;
}

type Reply = Recording | Error | 'hang';

/** Recorded Telegram: returns the given responses, in order, and keeps the requests. */
function telegram(...replies: Reply[]) {
  const requests: ReceivedRequest[] = [];
  let next = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const form = init.body instanceof FormData ? init.body : null;
    requests.push({
      url: String(url),
      init,
      json:
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      form,
    });
    const reply = replies[Math.min(next++, replies.length - 1)];
    if (!reply) throw new Error('No recorded response');
    if (reply instanceof Error) throw reply;
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    }
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const noWait = () => Promise.resolve();

const adapter = (
  fetch: typeof globalThis.fetch,
  {
    destination = DESTINATION,
    timeoutMs,
  }: { destination?: ConfiguredDestination; timeoutMs?: number } = {},
) => telegramAdapter(destination, { fetch, timeoutMs, sleep: noWait });

const text = (request: ReceivedRequest | undefined) => String(request?.json?.text);

describe('Telegram adapter', () => {
  it('posts the Feedback with sendMessage in HTML, and returns the link of the supergroup message', async () => {
    const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'delivered',
      externalUrl: SUPERGROUP_LINK,
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(`${API}/sendMessage`);
    expect(request?.init.method).toBe('POST');
    expect(request?.init.redirect).toBe('manual');
    expect(new Headers(request?.init.headers).get('content-type')).toBe('application/json');
    expect(request?.json).toMatchObject({
      chat_id: String(SUPERGROUP_ID),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    expect(request?.json).not.toHaveProperty('message_thread_id');
    expect(text(request)).toBe(
      [
        '<b>Bug · Shop &lt;Web&gt;</b>',
        '<pre>The cart empties when I change pages. &lt;b&gt;Really&lt;/b&gt; &amp; @support</pre>',
        '<b>Type</b>: Bug',
        '<b>Severity</b>: Major',
        '<b>Author</b>: Ada &lt;ada@client.test&gt; (u-42) · attested',
        '<b>Project</b>: Shop &lt;Web&gt;',
        `nudge · <a href="${DELIVERY.feedback.dashboardUrl}">View the feedback in nudge</a>`,
      ].join('\n'),
    );
  });

  it.each([
    ['a public channel', TELEGRAM.postedInPublicChannel, `https://t.me/shop_status/${MESSAGE_ID}`],
    ['a private chat', TELEGRAM.postedInPrivateChat, null],
    ['a basic group', TELEGRAM.postedInGroup, null],
  ] as const)(
    'links a message posted in %s only when Telegram allows it',
    async (_, posted, link) => {
      const { fetch } = telegram(posted);

      expect(await adapter(fetch).send(DELIVERY)).toEqual({
        status: 'delivered',
        externalUrl: link,
      });
    },
  );

  it('marks the test Feedback and the uncertain Verdict; without Severity, Author or dashboard link', async () => {
    const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

    await adapter(fetch).send({
      ...DELIVERY,
      isTest: true,
      feedback: {
        ...DELIVERY.feedback,
        severity: null,
        uncertain: true,
        author: null,
        dashboardUrl: null,
      },
    });

    const message = text(requests[0]);
    expect(message).toMatch(/^<b>Test · Bug · /);
    expect(message).toContain('<b>Severity</b>: Not assessed');
    expect(message).not.toContain('Author');
    expect(message).not.toContain('<a ');
    expect(message.split('\n').at(-1)).toBe('nudge · Uncertain verdict');
  });

  it('lets no mention fire outside the Author’s text block', async () => {
    const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

    await adapter(fetch).send({
      ...DELIVERY,
      project: { ...DELIVERY.project, name: '@admins Shop' },
      feedback: { ...DELIVERY.feedback, author: { name: '@channel_owner', trust: 'declared' } },
    });

    const outsideBlock = text(requests[0]).replace(/<pre>[\s\S]*<\/pre>/, '');
    expect(outsideBlock).not.toMatch(/(^|[^\w])@\w/);
  });

  it('truncates a text too long for a message', async () => {
    const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

    await adapter(fetch).send({
      ...DELIVERY,
      feedback: { ...DELIVERY.feedback, text: '<'.repeat(5000) },
    });

    const message = text(requests[0]);
    // What Telegram counts: the text once its tags and entities are parsed.
    const parsed = message.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|#39);/g, '_');
    expect(parsed.length).toBeLessThanOrEqual(4096);
    expect(message).toMatch(/&lt;…<\/pre>/);
  });

  describe('Capture', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const withCapture = (read: () => Promise<Uint8Array | null>): OutgoingDelivery => ({
      ...DELIVERY,
      feedback: {
        ...DELIVERY.feedback,
        capture: { contentType: 'image/png', bytes: png.length, read },
      },
    });

    it('sends the Capture with the message: sendPhoto, the message as its caption', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      expect(await adapter(fetch).send(withCapture(() => Promise.resolve(png)))).toEqual({
        status: 'delivered',
        externalUrl: SUPERGROUP_LINK,
      });

      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request?.url).toBe(`${API}/sendPhoto`);
      const form = request?.form;
      expect(form?.get('chat_id')).toBe(String(SUPERGROUP_ID));
      expect(form?.get('parse_mode')).toBe('HTML');
      expect(String(form?.get('caption'))).toMatch(/^<b>Bug · Shop &lt;Web&gt;<\/b>\n<pre>/);
      const photo = form?.get('photo') as File;
      expect(photo.type).toBe('image/png');
      expect(new Uint8Array(await photo.arrayBuffer())).toEqual(png);
    });

    it('bounds the caption to Telegram’s 1024 characters', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);
      const long = { ...withCapture(() => Promise.resolve(png)) };

      await adapter(fetch).send({
        ...long,
        feedback: { ...long.feedback, text: 'x'.repeat(5000) },
      });

      const caption = String(requests[0]?.form?.get('caption'));
      expect(
        caption.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp);/g, '_').length,
      ).toBeLessThanOrEqual(1024);
    });

    it('without the image in storage, sends the message alone', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      await adapter(fetch).send(withCapture(() => Promise.resolve(null)));

      expect(requests[0]?.url).toBe(`${API}/sendMessage`);
    });

    it('unreachable storage is a transient failure, nothing is posted', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      expect(
        await adapter(fetch).send(withCapture(() => Promise.reject(new Error('S3 down')))),
      ).toMatchObject({ status: 'failed', failureClass: 'transient' });
      expect(requests).toHaveLength(0);
    });
  });

  it('sends every message to the configured forum topic', async () => {
    const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);
    const inTopic = adapter(fetch, { destination: IN_TOPIC });
    const png = new Uint8Array([1]);

    await inTopic.send(DELIVERY);
    await inTopic.send({
      ...DELIVERY,
      feedback: {
        ...DELIVERY.feedback,
        capture: { contentType: 'image/png', bytes: 1, read: () => Promise.resolve(png) },
      },
    });
    await inTopic.deliverIncident(incidentOpening(DESTINATION.projectId!));
    await inTopic.closeIncident(incidentClosing(DESTINATION.projectId!, SUPERGROUP_LINK));
    await inTopic.alert(IN_REVIEW_ALERT);
    await inTopic.summarizeHeld(HELD_SUMMARY);

    expect(requests).toHaveLength(6);
    for (const request of requests) {
      expect(request.json?.message_thread_id ?? request.form?.get('message_thread_id')).toEqual(
        request.form ? '42' : 42,
      );
    }
  });

  it.each([
    ['401 rejected token', 'auth', TELEGRAM.unauthorized],
    ['403 bot removed from the chat', 'auth', TELEGRAM.kicked],
    ['403 bot blocked by the person', 'auth', TELEGRAM.blocked],
    ['400 chat not found', 'auth', TELEGRAM.chatNotFound],
    ['400 forum topic not found', 'auth', TELEGRAM.threadNotFound],
    ['400 rejected message', 'permanent', TELEGRAM.badEntities],
    ['429 with a long retry_after', 'transient', TELEGRAM.rateLimitedLong],
    ['502 gateway', 'transient', TELEGRAM.badGateway],
  ] as const)('classifies a %s response: %s', async (_, failureClass, recording) => {
    const { fetch, requests } = telegram(recording);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'failed',
      failureClass,
      message: expect.stringContaining(String(recording.status)),
    });
    expect(requests).toHaveLength(1);
  });

  it('honours a short retry_after: waits that long, then sends again once', async () => {
    const { fetch, requests } = telegram(TELEGRAM.rateLimited, TELEGRAM.postedInSupergroup);
    const sleep = vi.fn(noWait);

    const result = await telegramAdapter(DESTINATION, { fetch, sleep }).send(DELIVERY);

    expect(result).toEqual({ status: 'delivered', externalUrl: SUPERGROUP_LINK });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
    expect(requests).toHaveLength(2);
  });

  it('a retry_after beyond the wait it allows is a transient failure naming the wait', async () => {
    const { fetch, requests } = telegram(TELEGRAM.rateLimitedLong);
    const sleep = vi.fn(noWait);

    expect(await telegramAdapter(DESTINATION, { fetch, sleep }).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
      message: expect.stringContaining('retry after 40'),
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it("carries over Telegram's description, never the bot token", async () => {
    const { fetch } = telegram(TELEGRAM.chatNotFound);

    const result = await adapter(fetch).send(DELIVERY);

    expect(result).toMatchObject({ message: expect.stringContaining('chat not found') });
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN.split(':')[1]);
  });

  it('does not follow redirects: a 3xx is a permanent failure', async () => {
    const { fetch } = telegram({ provenance: 'reconstructed', source: '', status: 302 });

    expect(await adapter(fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'permanent',
    });
  });

  it('a network error or a timeout is transient', async () => {
    expect(
      await adapter(telegram(new TypeError('fetch failed')).fetch).send(DELIVERY),
    ).toMatchObject({ status: 'failed', failureClass: 'transient', message: 'fetch failed' });
    expect(await adapter(telegram('hang').fetch, { timeoutMs: 50 }).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
    });
  });

  it('refuses to build without a valid bot token: it goes in the URL path', () => {
    expect(() =>
      telegramAdapter({ ...DESTINATION, secrets: { botToken: '1:abc/../../evil' } }),
    ).toThrow(/bot token/);
  });

  describe('alert (Alert destination)', () => {
    it('posts the alert, linking to the dashboard, without a message link', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toEqual({
        status: 'delivered',
        externalUrl: null,
      });

      expect(requests[0]?.url).toBe(`${API}/sendMessage`);
      const message = text(requests[0]);
      expect(message).toMatch(/^<b>Feedback in review · @\u200beveryone \*Shop\*<\/b>\n/);
      expect(message).toContain('influence Triage');
      expect(message).toContain(`<b>Feedback</b>: ${IN_REVIEW_ALERT.feedback.id}`);
      expect(message).toContain(`<a href="${IN_REVIEW_ALERT.dashboardUrl}">Open in nudge</a>`);
    });

    it("escapes the Destination's name and the target's refusal", async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      await adapter(fetch).alert(SUSPENSION_ALERT);

      const message = text(requests[0]);
      expect(message).not.toContain('<a ');
      expect(message).toContain('<b>Destination</b>: Linear [prod](https://trap.test)');
      expect(message).toContain(
        '<b>Last refusal</b>\n<pre>HTTP 401: &lt;!channel&gt; @here `token` rejected</pre>',
      );
    });

    it('classifies a refusal like a Delivery: a rejected token is auth', async () => {
      const { fetch } = telegram(TELEGRAM.unauthorized);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toMatchObject({
        status: 'failed',
        failureClass: 'auth',
      });
    });
  });

  describe('summarizeHeld', () => {
    it('posts the summary, the Project name escaped', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      expect(await adapter(fetch).summarizeHeld(HELD_SUMMARY)).toEqual({
        status: 'delivered',
        externalUrl: null,
      });

      const message = text(requests[0]);
      expect(message).toMatch(/^<b>Incidents held · @\u200beveryone \*Shop\* &lt;b&gt;<\/b>\n/);
      expect(message).toContain('37 Incidents were held');
      expect(message).toContain('<b>Held</b>: 37');
      expect(message).toContain(`<a href="${HELD_SUMMARY.dashboardUrl}">`);
    });
  });

  describe('healthCheck', () => {
    it('checks the token with getMe, then the chat with getChat, posting nothing', async () => {
      const { fetch, requests } = telegram(TELEGRAM.me, TELEGRAM.chat);

      expect(await adapter(fetch).healthCheck()).toEqual({ reachable: true });

      expect(requests.map((r) => r.url)).toEqual([`${API}/getMe`, `${API}/getChat`]);
      expect(requests[1]?.json).toEqual({ chat_id: String(SUPERGROUP_ID) });
    });

    it('a rejected token makes it unreachable (auth), without asking for the chat', async () => {
      const { fetch, requests } = telegram(TELEGRAM.unauthorized);

      expect(await adapter(fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'auth',
        message: expect.stringContaining('401'),
      });
      expect(requests).toHaveLength(1);
    });

    it.each([
      ['400 chat not found', 'auth', TELEGRAM.chatNotFound],
      ['403 bot removed from the chat', 'auth', TELEGRAM.kicked],
      ['502 gateway', 'transient', TELEGRAM.badGateway],
    ] as const)(
      'a %s answer to getChat makes it unreachable (%s)',
      async (_, failureClass, recording) => {
        const { fetch } = telegram(TELEGRAM.me, recording);

        expect(await adapter(fetch).healthCheck()).toEqual({
          reachable: false,
          failureClass,
          message: expect.stringContaining(String(recording.status)),
        });
      },
    );

    it('a network error makes it unreachable (transient)', async () => {
      const { fetch } = telegram(new TypeError('fetch failed'));

      expect(await adapter(fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'transient',
        message: 'fetch failed',
      });
    });
  });

  describe('Incidents', () => {
    const OPENING = incidentOpening(DESTINATION.projectId!);
    const CLOSING = incidentClosing(DESTINATION.projectId!, SUPERGROUP_LINK);

    it('posts the opening of an Incident, and returns the message link to reply to it', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      expect(await adapter(fetch).deliverIncident(OPENING)).toEqual({
        status: 'delivered',
        externalUrl: SUPERGROUP_LINK,
      });

      expect(requests[0]?.url).toBe(`${API}/sendMessage`);
      const message = text(requests[0]);
      expect(message).toMatch(
        /^<b>Error · @\u200beveryone &lt;b&gt;Payment&lt;\/b&gt; timed out<\/b>\nAn Incident opened in Shop \(production\)\.\n/,
      );
      expect(message).toContain('<b>Level</b>: Error (declared)');
      expect(message).toContain('<b>Occurrences</b>: 3');
      expect(message).toContain('<b>Context</b>\n<pre>service: checkout\nretried: true</pre>');
      expect(message).toContain(`<a href="${OPENING.incident.dashboardUrl}">`);
      expect(requests[0]?.json).not.toHaveProperty('reply_parameters');
    });

    it('closes by replying to the opening message, and keeps its link', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      expect(await adapter(fetch).closeIncident(CLOSING)).toEqual({
        status: 'delivered',
        externalUrl: SUPERGROUP_LINK,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(`${API}/sendMessage`);
      expect(requests[0]?.json?.reply_parameters).toEqual({
        message_id: MESSAGE_ID,
        allow_sending_without_reply: true,
      });
      const message = text(requests[0]);
      expect(message).toMatch(/^<b>Closed · Error · /);
      expect(message).toContain('An Incident of Shop was resolved by its sender.');
      expect(message).toContain('<b>Closed</b>: 2026-10-24T09:31:00.000Z');
    });

    it('replies to an opening in a public channel too', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInPublicChannel);

      await adapter(fetch).closeIncident(
        incidentClosing(DESTINATION.projectId!, `https://t.me/shop_status/${MESSAGE_ID}`),
      );

      expect(requests[0]?.json?.reply_parameters).toMatchObject({ message_id: MESSAGE_ID });
    });

    it('posts the closing as a message of its own when the opening left no link (private chat, basic group)', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInPrivateChat);

      expect(
        await adapter(fetch).closeIncident(incidentClosing(DESTINATION.projectId!, null)),
      ).toEqual({ status: 'delivered', externalUrl: null });

      expect(requests[0]?.json).not.toHaveProperty('reply_parameters');
      expect(text(requests[0])).toMatch(/^<b>Closed · /);
    });

    it('classifies a refused closing like a Delivery: a removed bot is auth', async () => {
      const { fetch } = telegram(TELEGRAM.kicked);

      expect(await adapter(fetch).closeIncident(CLOSING)).toMatchObject({
        status: 'failed',
        failureClass: 'auth',
      });
    });

    it('"opened then closed" after a suspension is a single message, in its final state', async () => {
      const { fetch, requests } = telegram(TELEGRAM.postedInSupergroup);

      await adapter(fetch).deliverIncident(incidentOpenedThenClosed(DESTINATION.projectId!));

      expect(requests).toHaveLength(1);
      expect(text(requests[0])).toMatch(/^<b>Closed · Error · /);
    });
  });

  it('is registered for the "telegram" type in the adapter registry', () => {
    const resolved = resolveDestinationAdapter(DESTINATION);

    expect(typeof resolved.send).toBe('function');
    expect(typeof resolved.healthCheck).toBe('function');
  });
});
