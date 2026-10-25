import type { ConfiguredDestination, OutgoingDelivery } from '@nudge/core';
import { describe, expect, it } from 'vitest';
import { resolveDestinationAdapter } from './index.js';
import { slackAdapter } from './slack.js';
import { IN_REVIEW_ALERT, SUSPENSION_ALERT } from './test/alerts.js';
import {
  TEAM_ID,
  SERVICE_ID,
  SLACK,
  WEBHOOK_TOKEN,
  type Recording,
} from './test/slack-recordings.js';

const WEBHOOK_URL = `https://hooks.slack.com/services/${TEAM_ID}/${SERVICE_ID}/${WEBHOOK_TOKEN}`;

const DESTINATION: ConfiguredDestination = {
  id: '6f1c2a40-0000-4000-8000-000000000031',
  projectId: '6f1c2a40-0000-4000-8000-000000000032',
  name: 'Channel #bugs',
  type: 'slack',
  config: {},
  secrets: { url: WEBHOOK_URL },
};

const DELIVERY: OutgoingDelivery = {
  deliveryId: '6f1c2a40-0000-4000-8000-000000000033',
  isTest: false,
  project: { id: DESTINATION.projectId!, name: 'Shop' },
  feedback: {
    id: '6f1c2a40-0000-4000-8000-000000000034',
    text: 'The cart empties when I change pages.',
    source: 'widget',
    resolvedType: 'bug',
    severity: 'major',
    uncertain: false,
    author: { id: 'u-42', email: 'ada@client.test', trust: 'declared' },
    context: { url: 'https://shop.test/cart' },
    capture: null,
    receivedAt: new Date('2026-10-24T09:29:58.000Z'),
    dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000034',
  },
};

interface ReceivedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Headers;
  readonly body: string | null;
}

type Reply = Recording | Error | 'hang';

/** Recorded Slack: returns the given responses, in order, and keeps the requests. */
function slack(...replies: Reply[]) {
  const requests: ReceivedRequest[] = [];
  let next = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      init,
      headers: new Headers(init.headers),
      body: init.body === undefined ? null : String(init.body),
    });
    const reply = replies[Math.min(next++, replies.length - 1)];
    if (!reply) throw new Error('No recorded response');
    if (reply instanceof Error) throw reply;
    if (reply === 'hang') {
      // Never answers: only the adapter's timeout (signal) interrupts it.
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    }
    return new Response(reply.body, {
      status: reply.status,
      headers: { 'content-type': 'text/plain', ...reply.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const adapter = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  slackAdapter(DESTINATION, { fetch, timeoutMs });

interface TextObject {
  readonly type: string;
  readonly text: string;
  readonly verbatim?: boolean;
}

interface Block {
  readonly type: string;
  readonly text?: TextObject;
  readonly fields?: readonly TextObject[];
  readonly elements?: readonly TextObject[];
}

/** What the adapter posts to the incoming webhook. */
interface MessageBody {
  readonly text: string;
  readonly blocks: readonly Block[];
}

const jsonBody = (request: ReceivedRequest | undefined) =>
  JSON.parse(request!.body!) as MessageBody;

/** All the texts of the message, blocks included. */
const texts = (body: MessageBody): TextObject[] =>
  body.blocks.flatMap((block) => [
    ...(block.text ? [block.text] : []),
    ...(block.fields ?? []),
    ...(block.elements ?? []),
  ]);

describe('Slack adapter', () => {
  it('posts the Feedback to the incoming webhook as blocks; delivered, without a link (the webhook returns none)', async () => {
    const { fetch, requests } = slack(SLACK.ok);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({ status: 'delivered', externalUrl: null });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(WEBHOOK_URL);
    expect(request?.init.method).toBe('POST');
    expect(request?.init.redirect).toBe('manual');
    expect(request?.headers.get('content-type')).toBe('application/json');
    const body = jsonBody(request);
    // Fallback text (notifications): never the Author's text.
    expect(body.text).toBe('Bug · Shop');
    const content = texts(body).map((t) => t.text);
    expect(content.join('\n')).toContain('The cart empties when I change pages.');
    expect(content).toContainEqual('*Type*\nBug');
    expect(content).toContainEqual('*Severity*\nMajor');
    expect(content).toContainEqual('*Project*\nShop');
    expect(content.join('\n')).toContain(
      `<${DELIVERY.feedback.dashboardUrl}|View the feedback in nudge>`,
    );
  });

  it.each([
    // This Feedback's message is rejected: the next ones can go through.
    ['400 invalid_payload', 'permanent', SLACK.invalidPayload],
    ['400 no_text', 'permanent', SLACK.noText],
    ['400 too_many_attachments', 'permanent', SLACK.tooManyAttachments],
    // The webhook, its channel or the workspace reject every Delivery (D21).
    ['400 user_not_found', 'auth', SLACK.userNotFound],
    ['403 action_prohibited', 'auth', SLACK.actionProhibited],
    ['403 invalid_token', 'auth', SLACK.invalidToken],
    ['403 posting_to_general_channel_denied', 'auth', SLACK.postingToGeneralChannelDenied],
    ['404 channel_not_found', 'auth', SLACK.channelNotFound],
    ['404 no_service', 'auth', SLACK.noService],
    ['410 channel_is_archived', 'auth', SLACK.channelIsArchived],
    ['429 rate limit', 'transient', SLACK.rateLimited],
    ['500 rollup_error', 'transient', SLACK.rollupError],
    ['502 gateway', 'transient', SLACK.badGateway],
  ] as const)('classifies a %s response: %s', async (_, failureClass, recording) => {
    const { fetch, requests } = slack(recording);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'failed',
      failureClass,
      message: expect.stringContaining(String(recording.status)),
    });
    expect(requests).toHaveLength(1);
  });

  it("carries Slack's error code over, never the webhook token", async () => {
    const { fetch } = slack(SLACK.noService);

    const result = await adapter(fetch).send(DELIVERY);

    expect(result).toMatchObject({ message: 'HTTP 404: no_service' });
    expect(JSON.stringify(result)).not.toContain(WEBHOOK_TOKEN);
  });

  it('does not follow redirects: a 3xx is a permanent failure', async () => {
    const { fetch, requests } = slack({
      provenance: 'reconstructed',
      source: '',
      status: 302,
      body: '',
    });

    expect(await adapter(fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'permanent',
    });
    expect(requests[0]?.init.redirect).toBe('manual');
  });

  it('a network error or a timeout is transient', async () => {
    expect(await adapter(slack(new TypeError('fetch failed')).fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
      message: 'fetch failed',
    });
    expect(await adapter(slack('hang').fetch, 50).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
    });
  });

  describe('alert (Alert destination)', () => {
    it('posts the alert as blocks, with the link to the dashboard', async () => {
      const { fetch, requests } = slack(SLACK.ok);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toEqual({
        status: 'delivered',
        externalUrl: null,
      });

      const body = jsonBody(requests[0]);
      expect(body.text).toBe('Feedback in review · @​everyone *Shop*');
      const content = texts(body);
      expect(content.every((t) => t.verbatim === true)).toBe(true);
      const raw = content.map((t) => t.text);
      expect(raw.join('\n')).toContain('influence Triage');
      expect(raw).toContainEqual('*Project*\n@​everyone *Shop*');
      expect(raw).toContainEqual(`*Feedback*\n${IN_REVIEW_ALERT.feedback.id}`);
      expect(raw.join('\n')).toContain(`<${IN_REVIEW_ALERT.dashboardUrl}|Open in nudge>`);
    });

    it("neutralizes the control characters and mentions of the target's refusal", async () => {
      const { fetch, requests } = slack(SLACK.ok);

      await adapter(fetch).alert(SUSPENSION_ALERT);

      const raw = texts(jsonBody(requests[0])).map((t) => t.text);
      expect(raw).toContainEqual(
        '*Last refusal*\nHTTP 401: &lt;!channel&gt; @​here `token` rejected',
      );
      expect(raw.join('\n')).not.toContain('<!channel>');
      expect(raw.join('\n')).not.toContain('Open in nudge');
    });

    it('classifies a refusal like a Delivery: deleted webhook = auth', async () => {
      const { fetch } = slack(SLACK.noService);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toMatchObject({
        status: 'failed',
        failureClass: 'auth',
      });
    });
  });

  describe('healthCheck', () => {
    it('posts a message without text, which Slack rejects without publishing anything: no_text proves a live webhook', async () => {
      const { fetch, requests } = slack(SLACK.noText);

      expect(await adapter(fetch).healthCheck()).toEqual({ reachable: true });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(WEBHOOK_URL);
      expect(requests[0]?.init.method).toBe('POST');
      expect(JSON.parse(requests[0]!.body!)).toEqual({});
    });

    it('invalid_payload also proves a live webhook', async () => {
      expect(await adapter(slack(SLACK.invalidPayload).fetch).healthCheck()).toEqual({
        reachable: true,
      });
    });

    it.each([
      ['403 invalid_token', 'auth', SLACK.invalidToken],
      ['404 no_service', 'auth', SLACK.noService],
      ['410 channel_is_archived', 'auth', SLACK.channelIsArchived],
      ['429 rate limit', 'transient', SLACK.rateLimited],
      ['502 gateway', 'transient', SLACK.badGateway],
    ] as const)('a %s response makes it unreachable (%s)', async (_, failureClass, recording) => {
      expect(await adapter(slack(recording).fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass,
        message: expect.stringContaining(String(recording.status)),
      });
    });

    it('a network error makes it unreachable (transient)', async () => {
      expect(await adapter(slack(new TypeError('fetch failed')).fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'transient',
        message: 'fetch failed',
      });
    });
  });

  it('marks the test Feedback and the uncertain Verdict; without Severity or dashboard link', async () => {
    const { fetch, requests } = slack(SLACK.ok);
    const feedback = { ...DELIVERY.feedback, severity: null, uncertain: true, dashboardUrl: null };

    await adapter(fetch).send({ ...DELIVERY, isTest: true, feedback });

    const body = jsonBody(requests[0]);
    expect(body.text).toBe('Test · Bug · Shop');
    const content = texts(body).map((t) => t.text);
    expect(content[0]).toBe('*Test · Bug · Shop*');
    expect(content).toContainEqual('*Severity*\nNot assessed');
    expect(content.join('\n')).toContain('Uncertain verdict');
    expect(content.join('\n')).not.toContain('View the feedback');
  });

  describe("encoding of the Author's text", () => {
    const MALICIOUS = [
      '<!channel> <!here> <!everyone> @channel @here URGENT <@U012AB3CD> <#C123ABC456>',
      '<https://trap.test/login|click here> or https://trap.test/direct',
      '*bold* _italic_ ~struck~ <!date^1392734382^{date}|tomorrow> & &amp; &lt;',
      '```',
      'end of block? <!channel>',
      '````js',
    ].join('\n');

    async function message(text: string, project = DELIVERY.project) {
      const { fetch, requests } = slack(SLACK.ok);
      await adapter(fetch).send({
        ...DELIVERY,
        project,
        feedback: { ...DELIVERY.feedback, text },
      });
      return jsonBody(requests[0]);
    }

    /** The Author's text: the message's only code block. */
    const codeBlock = (body: MessageBody) =>
      texts(body).find((t) => t.text.startsWith('```'))!.text;

    /** What Slack displays of an escaped text (`&amp;`, `&lt;`, `&gt;`). */
    const displayed = (text: string) =>
      text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

    it('escapes &, < and >: no mention, link or date is interpreted', async () => {
      const body = await message(MALICIOUS);

      const text = codeBlock(body);
      expect(text).not.toMatch(/[<>]/);
      expect(text).not.toMatch(/&(?!amp;|lt;|gt;)/);
      expect(text).toContain('&lt;!channel&gt;');
      expect(text).not.toMatch(/@(channel|here|everyone)\b/);
      // Slack does not modify the text of a `verbatim` object: no bare link, no channel.
      expect(texts(body).every((t) => t.type === 'mrkdwn' && t.verbatim === true)).toBe(true);
      expect(body.text).not.toContain(MALICIOUS.slice(0, 10));
    });

    it('wraps the text in a code block it cannot close', async () => {
      const text = codeBlock(await message(MALICIOUS));

      expect(text.startsWith('```\n')).toBe(true);
      expect(text.endsWith('\n```')).toBe(true);
      const inside = text.slice(4, -4);
      expect(inside).not.toContain('``');
      // To the eye, it is the Author's text, give or take zero-width spaces.
      expect(displayed(inside).replaceAll('​', '')).toBe(MALICIOUS);
    });

    it.each([
      ['a', 'a'],
      ['&', '&amp;'],
    ])(
      'truncates a text too long for a section ("%s"), without splitting an entity',
      async (char, encoded) => {
        const text = codeBlock(await message(char.repeat(5000)));

        expect(text.length).toBeLessThanOrEqual(3000);
        expect(text.endsWith('…\n```')).toBe(true);
        expect(text.slice(4, -5).replaceAll(encoded, '')).toBe('');
      },
    );

    it('escapes the Project name everywhere it is displayed', async () => {
      const body = await message('Hello', {
        ...DELIVERY.project,
        name: '<!channel> <https://trap.test|Shop> & co',
      });

      expect(body.text).toBe('Bug · &lt;!channel&gt; &lt;https://trap.test|Shop&gt; &amp; co');
      for (const { text } of texts(body)) {
        expect(text).not.toContain('<!channel>');
        expect(text).not.toContain('<https://trap.test');
      }
    });
  });

  it('is registered for the "slack" type in the adapter registry', () => {
    const resolved = resolveDestinationAdapter(DESTINATION);

    expect(typeof resolved.send).toBe('function');
    expect(typeof resolved.healthCheck).toBe('function');
  });
});
