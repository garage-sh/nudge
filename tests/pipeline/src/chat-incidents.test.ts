import type { DestinationWithGeneratedSecrets, IncidentDetailView } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const WEBHOOK_ID = '223704706495545344';
const WEBHOOK_TOKEN = 'incident-test-token';
const GUILD_ID = '199737254929760256';
const CHANNEL_ID = '199737254929760257';
const ENDPOINT = `https://discord.com/api/v10/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;

interface DiscordRequest {
  readonly method: string;
  readonly url: string;
  readonly body: { readonly embeds: readonly [{ readonly title: string }] } | null;
}

/**
 * A recorded Discord channel webhook: "Execute Webhook" creates a numbered message,
 * "Edit Webhook Message" edits one, "Get Webhook with Token" names the guild.
 */
function recordedDiscord() {
  const requests: DiscordRequest[] = [];
  let nextMessage = 334385199974967000;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    requests.push({
      method,
      url: String(url),
      body: init.body ? (JSON.parse(String(init.body)) as DiscordRequest['body']) : null,
    });
    if (method === 'POST') return json({ id: String(nextMessage++), channel_id: CHANNEL_ID });
    if (method === 'PATCH') return json({ id: String(url).split('/').pop() });
    return json({ id: WEBHOOK_ID, guild_id: GUILD_ID, channel_id: CHANNEL_ID });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const BOT_TOKEN = '4839574812:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw8';
const SUPERGROUP_ID = -1001234567890;
const BOT_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

interface TelegramRequest {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** A recorded Telegram Bot API: `sendMessage` posts a numbered message in a supergroup. */
function recordedTelegram() {
  const requests: TelegramRequest[] = [];
  let nextMessage = 2187;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const result = {
      message_id: nextMessage++,
      chat: { id: SUPERGROUP_ID, title: 'On-call', type: 'supergroup' },
      date: 1792834200,
    };
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

/**
 * The real Discord, Telegram and email adapters receive an Incident's opening and its closing:
 * the Discord message is edited in place, the Telegram closing replies to the opening
 * message, the closing mail replies to the opening one.
 */
describe('Incidents through the chat and email adapters end to end', () => {
  const discord = recordedDiscord();
  const telegram = recordedTelegram();
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline({
      destinations: 'real',
      adapterFetch: ((url: string | URL, init?: RequestInit) =>
        String(url).startsWith(BOT_API)
          ? telegram.fetch(url, init)
          : discord.fetch(url, init)) as typeof globalThis.fetch,
    });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const anyLevel = { minimumLevel: 'info', environments: [], conditions: [] };

  const waitForIncident = async (
    id: string,
    condition: (incident: IncidentDetailView) => boolean,
  ) => {
    await expect
      .poll(async () =>
        condition((await member.get<IncidentDetailView>(`/api/incidents/${id}`)).body),
      )
      .toBe(true);
    return (await member.get<IncidentDetailView>(`/api/incidents/${id}`)).body;
  };

  it('Discord: the opening message is edited into the closed Incident when a Member closes it', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Discord incidents' });
    const creation = await member.post<DestinationWithGeneratedSecrets>(
      `/api/projects/${project.id}/destinations`,
      {
        type: 'discord',
        name: 'On-call channel',
        config: {},
        secrets: { url: `https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}` },
        filter: null,
        incidentFilter: anyLevel,
      },
    );
    expect(creation.status).toBe(201);

    const response = await pipeline.postIncident(secretKey, {
      title: 'Payment provider timed out',
      level: 'critical',
    });
    const { id } = (await response.json()) as { id: string };
    const opened = await waitForIncident(id, (i) => i.deliveries[0]?.status === 'delivered');
    const [post] = discord.requests.filter((r) => r.method === 'POST');
    expect(post?.url).toBe(`${ENDPOINT}?wait=true`);
    expect(post?.body?.embeds[0].title).toBe('Critical · Payment provider timed out');
    const link = opened.deliveries[0]!.externalUrl!;
    expect(link).toMatch(
      new RegExp(`^https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/\\d+$`),
    );

    expect((await member.post(`/api/incidents/${id}/close`)).status).toBe(200);

    await expect.poll(() => discord.requests.filter((r) => r.method === 'PATCH').length).toBe(1);
    const [edit] = discord.requests.filter((r) => r.method === 'PATCH');
    expect(edit?.url).toBe(`${ENDPOINT}/messages/${link.split('/').pop()}`);
    expect(edit?.body?.embeds[0].title).toBe('Closed · Critical · Payment provider timed out');
    const closed = await waitForIncident(id, (i) => i.deliveries[0]?.status === 'delivered');
    expect(closed.deliveries[0]!.externalUrl).toBe(link);
    expect(discord.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('Telegram: the closing replies to the opening message, whose link the Delivery keeps', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Telegram incidents' });
    const creation = await member.post(`/api/projects/${project.id}/destinations`, {
      type: 'telegram',
      name: 'On-call group',
      config: { chatId: String(SUPERGROUP_ID), topicId: 7 },
      secrets: { botToken: BOT_TOKEN },
      filter: null,
      incidentFilter: anyLevel,
    });
    expect(creation.status).toBe(201);

    const occurrence = { title: 'Payment provider timed out', level: 'critical' };
    const response = await pipeline.postIncident(secretKey, occurrence);
    const { id } = (await response.json()) as { id: string };
    const opened = await waitForIncident(id, (i) => i.deliveries[0]?.status === 'delivered');
    const [post] = telegram.requests;
    expect(post?.url).toBe(`${BOT_API}/sendMessage`);
    expect(post?.body).toMatchObject({ chat_id: String(SUPERGROUP_ID), message_thread_id: 7 });
    expect(post?.body.text).toMatch(/^<b>Critical · Payment provider timed out<\/b>/);
    const link = opened.deliveries[0]!.externalUrl!;
    expect(link).toBe('https://t.me/c/1234567890/2187');

    await pipeline.postIncident(secretKey, { ...occurrence, resolved: true });

    await expect.poll(() => telegram.requests.length).toBe(2);
    const closing = telegram.requests[1];
    expect(closing?.body.reply_parameters).toEqual({
      message_id: 2187,
      allow_sending_without_reply: true,
    });
    expect(closing?.body.text).toMatch(/^<b>Closed · Critical · /);
    const closed = await waitForIncident(
      id,
      (i) => i.state === 'closed' && i.deliveries[0]?.status === 'delivered',
    );
    expect(closed.deliveries[0]!.externalUrl).toBe(link);
  });

  it('email: the closing mail replies to the opening one', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Email incidents' });
    const creation = await member.post(`/api/projects/${project.id}/destinations`, {
      type: 'email',
      name: 'On-call inbox',
      config: { recipients: ['oncall@shop.test'] },
      filter: null,
      incidentFilter: anyLevel,
    });
    expect(creation.status).toBe(201);
    const sent = () => pipeline.mailer.sent.filter((mail) => mail.to.includes('oncall@shop.test'));
    const occurrence = { title: 'Queue backed up', level: 'error' };

    await pipeline.postIncident(secretKey, occurrence);
    await expect.poll(() => sent().length).toBe(1);
    await pipeline.postIncident(secretKey, { ...occurrence, resolved: true });
    await expect.poll(() => sent().length).toBe(2);

    const [opening, closing] = sent();
    expect(opening!.subject).toBe('[nudge] Incident · Email incidents · Queue backed up');
    expect(closing!.subject).toBe(`Re: ${opening!.subject}`);
    expect(closing!.inReplyTo).toBe(opening!.messageId);
  });
});
