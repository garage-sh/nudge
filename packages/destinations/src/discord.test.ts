import type { ConfiguredDestination, OutgoingDelivery } from '@nudge/core';
import { describe, expect, it } from 'vitest';
import { discordAdapter } from './discord.js';
import { resolveDestinationAdapter } from './index.js';
import { IN_REVIEW_ALERT, SUSPENSION_ALERT } from './test/alerts.js';
import {
  DISCORD,
  MESSAGE_ID,
  CHANNEL_ID,
  GUILD_ID,
  WEBHOOK_ID,
  WEBHOOK_TOKEN,
  type Recording,
} from './test/discord-recordings.js';

const WEBHOOK_URL = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;
const ENDPOINT = `https://discord.com/api/v10/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;

const DESTINATION: ConfiguredDestination = {
  id: '6f1c2a40-0000-4000-8000-000000000011',
  projectId: '6f1c2a40-0000-4000-8000-000000000012',
  name: 'Channel #bugs',
  type: 'discord',
  config: {},
  secrets: { url: WEBHOOK_URL },
};

const DELIVERY: OutgoingDelivery = {
  deliveryId: '6f1c2a40-0000-4000-8000-000000000013',
  isTest: false,
  project: { id: DESTINATION.projectId!, name: 'Shop' },
  feedback: {
    id: '6f1c2a40-0000-4000-8000-000000000014',
    text: 'The cart empties when I change pages.',
    source: 'widget',
    resolvedType: 'bug',
    severity: 'major',
    uncertain: false,
    author: { id: 'u-42', email: 'ada@client.test', trust: 'declared' },
    context: { url: 'https://shop.test/cart' },
    capture: null,
    receivedAt: new Date('2026-10-24T09:29:58.000Z'),
    dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000014',
  },
};

interface ReceivedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Headers;
  readonly body: string | null;
}

type Reply = Recording | Error | 'hang';

/** Recorded Discord: returns the given responses, in order, and keeps the requests. */
function discord(...replies: Reply[]) {
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
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

/** A fresh adapter, with its own guild cache. */
const adapter = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  discordAdapter(DESTINATION, { fetch, timeoutMs, guilds: new Map() });

/** What the adapter posts to "Execute Webhook". */
interface ExecutionBody {
  readonly content?: string;
  readonly allowed_mentions?: unknown;
  /** A single embed: the first test checks it. */
  readonly embeds: readonly [
    {
      readonly title: string;
      readonly url?: string;
      readonly description: string;
      readonly timestamp: string;
      readonly fields: readonly { name: string; value: string; inline: boolean }[];
      readonly footer?: { text: string };
    },
  ];
}

const jsonBody = (request: ReceivedRequest | undefined) =>
  JSON.parse(request!.body!) as ExecutionBody;

describe('Discord adapter', () => {
  it('executes the channel webhook with an embed of the Feedback, and returns the message link', async () => {
    const { fetch, requests } = discord(DISCORD.createdMessage, DISCORD.webhook);

    const result = await adapter(fetch).send(DELIVERY);

    expect(result).toEqual({
      status: 'delivered',
      externalUrl: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`,
    });
    const [execution] = requests;
    expect(execution?.url).toBe(`${ENDPOINT}?wait=true`);
    expect(execution?.init.method).toBe('POST');
    expect(execution?.headers.get('content-type')).toBe('application/json');
    expect(execution?.headers.get('user-agent')).toMatch(/^DiscordBot \(https?:\/\/\S+, [\w.]+\)/);
    const body = jsonBody(execution);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toBeUndefined();
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0]).toMatchObject({
      title: 'Bug · Shop',
      url: DELIVERY.feedback.dashboardUrl,
      timestamp: '2026-10-24T09:29:58.000Z',
      fields: [
        { name: 'Type', value: 'Bug', inline: true },
        { name: 'Severity', value: 'Major', inline: true },
        { name: 'Project', value: 'Shop', inline: true },
      ],
    });
    expect(body.embeds[0].description).toContain('The cart empties when I change pages.');
  });

  it("reads the channel's guild from the webhook to build the link; without it, delivered without a link", async () => {
    const { fetch, requests } = discord(DISCORD.createdMessage, DISCORD.gatewayUnavailable);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({ status: 'delivered', externalUrl: null });

    const read = requests[1];
    expect(read?.url).toBe(ENDPOINT);
    expect(read?.init.method ?? 'GET').toBe('GET');
    expect(read?.body).toBeNull();
  });

  it.each([
    ['401 invalid token', 'auth', DISCORD.invalidToken],
    // "If a webhook returns a 404 status you should not attempt to use it again."
    ['404 deleted webhook', 'auth', DISCORD.unknownWebhook],
    ['400 rejected body', 'permanent', DISCORD.invalidBody],
    // A forum channel rejects every Delivery: the Destination is misconfigured.
    ['400 forum channel', 'auth', DISCORD.forumChannel],
    ['429 rate limit', 'transient', DISCORD.rateLimited],
    ['502 gateway', 'transient', DISCORD.gatewayUnavailable],
  ] as const)('classifies a %s response: %s', async (_, failureClass, recording) => {
    const { fetch, requests } = discord(recording);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'failed',
      failureClass,
      message: expect.stringContaining(String(recording.status)),
    });
    expect(requests).toHaveLength(1);
  });

  it("carries over Discord's error message, never the webhook token", async () => {
    const { fetch } = discord(DISCORD.invalidToken);

    const result = await adapter(fetch).send(DELIVERY);

    expect(result).toMatchObject({ message: expect.stringContaining('Invalid Webhook Token') });
    expect(JSON.stringify(result)).not.toContain(WEBHOOK_TOKEN);
  });

  it('does not follow redirects: a 3xx is a permanent failure', async () => {
    const { fetch, requests } = discord({ provenance: 'reconstructed', source: '', status: 301 });

    expect(await adapter(fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'permanent',
    });
    expect(requests[0]?.init.redirect).toBe('manual');
  });

  it('a network error or a timeout is transient', async () => {
    expect(
      await adapter(discord(new TypeError('fetch failed')).fetch).send(DELIVERY),
    ).toMatchObject({ status: 'failed', failureClass: 'transient', message: 'fetch failed' });
    expect(await adapter(discord('hang').fetch, 50).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
    });
  });

  it("reads a webhook's guild only once: it does not change", async () => {
    const { fetch, requests } = discord(
      DISCORD.createdMessage,
      DISCORD.webhook,
      DISCORD.createdMessage,
    );
    const guilds = new Map<string, string>();
    const link = `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`;

    expect(await discordAdapter(DESTINATION, { fetch, guilds }).send(DELIVERY)).toEqual({
      status: 'delivered',
      externalUrl: link,
    });
    expect(await discordAdapter(DESTINATION, { fetch, guilds }).send(DELIVERY)).toEqual({
      status: 'delivered',
      externalUrl: link,
    });

    expect(requests.map((r) => r.init.method ?? 'GET')).toEqual(['POST', 'GET', 'POST']);
  });

  it('marks the test Feedback and the uncertain Verdict; without Severity or dashboard link', async () => {
    const { fetch, requests } = discord(DISCORD.createdMessage, DISCORD.webhook);
    const feedback = { ...DELIVERY.feedback, severity: null, uncertain: true, dashboardUrl: null };

    await adapter(fetch).send({ ...DELIVERY, isTest: true, feedback });

    const [embed] = jsonBody(requests[0]).embeds;
    expect(embed.title).toBe('Test · Bug · Shop');
    expect(embed.url).toBeUndefined();
    expect(embed.fields).toContainEqual({ name: 'Severity', value: 'Not assessed', inline: true });
    expect(embed.footer).toEqual({ text: 'nudge · Uncertain verdict' });
  });

  describe('alert (Alert destination)', () => {
    it('posts an embed of the alert, linking to the dashboard, without mentions or reading the guild', async () => {
      const { fetch, requests } = discord(DISCORD.createdMessage);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toEqual({
        status: 'delivered',
        externalUrl: null,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(`${ENDPOINT}?wait=true`);
      const body = jsonBody(requests[0]);
      expect(body.allowed_mentions).toEqual({ parse: [] });
      expect(body.embeds[0]).toMatchObject({
        title: 'Feedback in review · @​everyone \\*Shop\\*',
        url: IN_REVIEW_ALERT.dashboardUrl,
        timestamp: '2026-10-24T09:30:00.000Z',
        fields: [
          { name: 'Project', value: '@​everyone \\*Shop\\*', inline: true },
          // The hyphen is escaped as in any text: Discord shows it as is.
          {
            name: 'Feedback',
            value: IN_REVIEW_ALERT.feedback.id.replaceAll('-', '\\-'),
            inline: true,
          },
        ],
      });
      expect(body.embeds[0].description).toContain('influence Triage');
    });

    it("escapes the Destination's name and the target's refusal, with no masked link or mention", async () => {
      const { fetch, requests } = discord(DISCORD.createdMessage);

      await adapter(fetch).alert(SUSPENSION_ALERT);

      const embed = jsonBody(requests[0]).embeds[0];
      expect(embed.url).toBeUndefined();
      expect(embed.title).toBe('Destination suspended · Linear \\[prod\\]\\(https://trap.test\\)');
      expect(embed.fields).toEqual([
        { name: 'Project', value: 'Shop', inline: true },
        { name: 'Destination', value: 'Linear \\[prod\\]\\(https://trap.test\\)', inline: true },
        {
          name: 'Last refusal',
          value: 'HTTP 401: \\<!channel\\> @​here \\`token\\` rejected',
          inline: false,
        },
      ]);
    });

    it('classifies a refusal like a Delivery: unknown webhook = auth', async () => {
      const { fetch } = discord(DISCORD.unknownWebhook);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toMatchObject({
        status: 'failed',
        failureClass: 'auth',
      });
    });
  });

  describe('healthCheck', () => {
    it('reads the webhook with its token, posting nothing; a 200 response makes it reachable', async () => {
      const { fetch, requests } = discord(DISCORD.webhook);

      expect(await adapter(fetch).healthCheck()).toEqual({ reachable: true });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(ENDPOINT);
      expect(requests[0]?.init.method ?? 'GET').toBe('GET');
      expect(requests[0]?.body).toBeNull();
    });

    it.each([
      ['401 invalid token', 'auth', DISCORD.invalidToken],
      ['404 deleted webhook', 'auth', DISCORD.unknownWebhook],
      ['429 rate limit', 'transient', DISCORD.rateLimited],
      ['502 gateway', 'transient', DISCORD.gatewayUnavailable],
    ] as const)('a %s response makes it unreachable (%s)', async (_, failureClass, recording) => {
      const { fetch } = discord(recording);

      expect(await adapter(fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass,
        message: expect.stringContaining(String(recording.status)),
      });
    });

    it('a network error makes it unreachable (transient)', async () => {
      const { fetch } = discord(new TypeError('fetch failed'));

      expect(await adapter(fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'transient',
        message: 'fetch failed',
      });
    });
  });

  describe("encoding of the Author's text", () => {
    const MALICIOUS = [
      '@everyone @here URGENT <@80351110224678912> <@&165511591545143296> <#103735883630395392>',
      '[click here](https://trap.test/login) or https://trap.test/direct',
      '**bold** _italic_ </airhorn:816437322781949972> <t:1618953630>',
      '```',
      'end of the block? @everyone',
      '````js',
    ].join('\n');

    async function description(text: string) {
      const { fetch, requests } = discord(DISCORD.createdMessage, DISCORD.webhook);
      await adapter(fetch).send({ ...DELIVERY, feedback: { ...DELIVERY.feedback, text } });
      const body = jsonBody(requests[0]);
      return { body, description: body.embeds[0].description };
    }

    it('lets no mention fire', async () => {
      const { body, description: text } = await description(MALICIOUS);

      // "parse: []": no mention is interpreted (docs.discord.com, Allowed Mentions).
      expect(body.allowed_mentions).toEqual({ parse: [] });
      expect(body.content).toBeUndefined();
      expect(text).not.toMatch(/@(everyone|here)/);
    });

    it('wraps the text in a code block it cannot close: no markdown, no clickable link', async () => {
      const { description: text } = await description(MALICIOUS);

      expect(text.startsWith('```\n')).toBe(true);
      expect(text.endsWith('\n```')).toBe(true);
      const inside = text.slice(4, -4);
      // No run of two backticks: the block only closes at the end.
      expect(inside).not.toContain('``');
      // To the eye, it is the Author's text, up to zero-width spaces.
      expect(inside.replaceAll('​', '')).toBe(MALICIOUS);
    });

    it('truncates a text too long for an embed', async () => {
      const { description: text } = await description('a'.repeat(5000));

      expect(text.length).toBeLessThanOrEqual(4096);
      expect(text.endsWith('…\n```')).toBe(true);
    });

    it('escapes the Project name, which is shown as markdown', async () => {
      const { fetch, requests } = discord(DISCORD.createdMessage, DISCORD.webhook);
      const project = { ...DELIVERY.project, name: '[Shop](https://trap.test) @everyone' };

      await adapter(fetch).send({ ...DELIVERY, project });

      const [embed] = jsonBody(requests[0]).embeds;
      const projectField = embed.fields.find((f) => f.name === 'Project');
      expect(projectField?.value).not.toContain('](');
      expect(projectField?.value).not.toMatch(/@(everyone|here)/);
      expect(embed.title).not.toContain('](');
    });
  });

  it('is registered for the "discord" type in the adapter registry', async () => {
    const adapter = resolveDestinationAdapter(DESTINATION);

    expect(typeof adapter.send).toBe('function');
    expect(typeof adapter.healthCheck).toBe('function');
  });
});
