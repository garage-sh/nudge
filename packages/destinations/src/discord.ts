import {
  presentAlert,
  presentHeldSummary,
  presentIncident,
  type Alert,
  type OutgoingHeldSummary,
  type PresentedAlert,
  type OutgoingIncidentClosing,
  type OutgoingIncidentDelivery,
  type FailureClass,
  type DestinationAdapter,
  type ConfiguredDestination,
  type OutgoingDelivery,
  type DeliveryResult,
} from '@nudge/core';
import {
  SEVERITY_LABELS,
  FEEDBACK_TYPE_LABELS,
  parseDiscordWebhook,
  type Level,
  type Severity,
  type DiscordSecrets,
} from '@nudge/shared';
import { DEFAULT_HTTP_TIMEOUT_MS, classifyStatus, httpFailure, errorMessage } from './http.js';
import { isSafeLink } from './markdown.js';
import { truncate } from './text.js';

export interface DiscordOptions {
  readonly fetch?: typeof globalThis.fetch;
  /** Discord response timeout, beyond which the call is a transient failure. */
  readonly timeoutMs?: number;
  /** Server (guild) of each webhook already read, by webhook id (tests: a fresh cache). */
  readonly guilds?: Map<string, string>;
}

/**
 * A webhook's server does not change: read once per process, it does not add a call
 * per Delivery against the webhook's rate limit.
 */
const GUILDS_BY_WEBHOOK = new Map<string, string>();

/** "User-Agent: DiscordBot ($url, $versionNumber)" (docs.discord.com/developers/reference). */
const USER_AGENT = 'DiscordBot (https://github.com/garage-sh/nudge, 1.0)';

/**
 * Discord: a channel webhook ("Execute Webhook",
 * https://docs.discord.com/developers/resources/webhook#execute-webhook).
 */
export function discordAdapter(
  destination: ConfiguredDestination,
  options: DiscordOptions = {},
): DestinationAdapter {
  const webhook = parseDiscordWebhook((destination.secrets as Partial<DiscordSecrets>).url ?? '');
  if (!webhook) throw new Error(`Discord ${destination.id} has no valid webhook URL`);
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const guilds = options.guilds ?? GUILDS_BY_WEBHOOK;
  const { id: webhookId, token } = webhook;
  const endpoint = `https://discord.com/api/v10/webhooks/${webhookId}/${token}`;

  const call = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT, ...init.headers },
    });

  /**
   * The link of a posted message: `https://discord.com/channels/<guild>/<channel>/<message>`.
   * The Message object does not carry the guild; the webhook, read with its token, does.
   * A failed read does not cancel the delivery: the link is missing, that is all.
   */
  async function messageLink({ id, channel_id }: CreatedMessage): Promise<string | null> {
    if (!id || !channel_id) return null;
    const guild = guilds.get(webhookId) ?? (await readGuild());
    return guild ? `https://discord.com/channels/${guild}/${channel_id}/${id}` : null;
  }

  async function readGuild(): Promise<string | null> {
    try {
      const response = await call(endpoint);
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const { guild_id } = (await response.json()) as { guild_id?: unknown };
      if (typeof guild_id !== 'string') return null;
      guilds.set(webhookId, guild_id);
      return guild_id;
    } catch {
      return null;
    }
  }

  /** A JSON call to the webhook: its response, or the network failure as transient. */
  async function request(
    url: string,
    method: 'POST' | 'PATCH',
    body: unknown,
  ): Promise<Response | Extract<DeliveryResult, { status: 'failed' }>> {
    try {
      return await call(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      return { status: 'failed', failureClass: 'transient', message: errorMessage(error) };
    }
  }

  /** "Execute Webhook": the created message, or the classified failure. */
  async function execute(
    body: unknown,
  ): Promise<{ ok: true; created: CreatedMessage } | { ok: false; failure: DeliveryResult }> {
    const response = await request(`${endpoint}?wait=true`, 'POST', body);
    if (!(response instanceof Response)) return { ok: false, failure: response };
    if (!response.ok)
      return { ok: false, failure: { status: 'failed', ...(await discordFailure(response)) } };
    return { ok: true, created: (await response.json().catch(() => ({}))) as CreatedMessage };
  }

  /** Posts a message: delivered with its link, or the classified failure. */
  async function post(body: unknown): Promise<DeliveryResult> {
    const execution = await execute(body);
    if (!execution.ok) return execution.failure;
    return { status: 'delivered', externalUrl: await messageLink(execution.created) };
  }

  /**
   * "Edit Webhook Message": `'gone'` when the message no longer exists (deleted from
   * the channel), which the webhook itself survives.
   */
  async function edit(messageId: string, body: unknown): Promise<DeliveryResult | 'gone'> {
    const response = await request(`${endpoint}/messages/${messageId}`, 'PATCH', body);
    if (!(response instanceof Response)) return response;
    if (response.ok) {
      await response.body?.cancel();
      return { status: 'delivered', externalUrl: null };
    }
    if (response.status === 404 && (await jsonCode(response)) === UNKNOWN_MESSAGE_CODE) {
      await response.body?.cancel();
      return 'gone';
    }
    return { status: 'failed', ...(await discordFailure(response)) };
  }

  return {
    send: (delivery) => post(discordBody(delivery)),
    /** The message's link is what finds it again to close it. */
    deliverIncident: (delivery) => post(incidentBody(delivery)),
    /**
     * Edits the opening message into the closed Incident. Without it (no link kept, or
     * the message deleted from the channel), the closing is a message of its own.
     */
    async closeIncident(closing) {
      const body = incidentBody(closing);
      const messageId = messageIdOf(closing.opening.externalUrl);
      if (messageId) {
        const edited = await edit(messageId, body);
        if (edited !== 'gone') {
          return edited.status === 'delivered'
            ? { status: 'delivered', externalUrl: closing.opening.externalUrl }
            : edited;
        }
      }
      return post(body);
    },
    /** No Delivery keeps the message link: the guild is not read for the summary. */
    async summarizeHeld(summary) {
      const execution = await execute(heldSummaryBody(summary));
      return execution.ok ? { status: 'delivered', externalUrl: null } : execution.failure;
    },
    /** The message link is kept nowhere: the guild is not read for the alert. */
    async alert(alert) {
      const execution = await execute(alertBody(alert));
      return execution.ok ? { status: 'delivered', externalUrl: null } : execution.failure;
    },
    /** "Get Webhook with Token": checks the token without posting in the channel. */
    async healthCheck() {
      let response: Response;
      try {
        response = await call(endpoint);
      } catch (error) {
        return { reachable: false, failureClass: 'transient', message: errorMessage(error) };
      }
      if (response.ok) {
        await response.body?.cancel();
        return { reachable: true };
      }
      return { reachable: false, ...(await discordFailure(response)) };
    },
  };
}

interface CreatedMessage {
  readonly id?: string;
  readonly channel_id?: string;
}

/** JSON code 10008 "Unknown message" (docs.discord.com/developers/topics/opcodes-and-status-codes). */
const UNKNOWN_MESSAGE_CODE = 10008;

/**
 * The id of the message a link of this adapter points at
 * (`https://discord.com/channels/<guild>/<channel>/<message>`), or `null`.
 */
function messageIdOf(link: string | null): string | null {
  const match = link ? /^https:\/\/discord\.com\/channels\/\d+\/\d+\/(\d+)$/.exec(link) : null;
  return match?.[1] ?? null;
}

/**
 * JSON codes of a forum channel webhook, which rejects every message without a thread
 * (docs.discord.com/developers/topics/opcodes-and-status-codes): 220001 "must have a
 * thread_name or thread_id", 220004 "Webhook services cannot be used in forum
 * channels", 40058 "Cannot send a message in a forum channel".
 */
const FORUM_CHANNEL_CODES = new Set([220001, 220004, 40058]);

/**
 * Class of a Discord refusal. The webhook itself is rejected, and the Destination
 * Suspended rather than each Delivery failing, when:
 * - it no longer exists (404): "If a webhook returns a 404 status you should not attempt
 *   to use it again" (docs.discord.com/developers/topics/rate-limits);
 * - it belongs to a forum channel, which will reject every Delivery.
 */
async function discordFailure(
  response: Response,
): Promise<{ failureClass: FailureClass; message: string }> {
  const code = response.status >= 400 && response.status < 500 ? await jsonCode(response) : null;
  const webhookRejected = (status: number) =>
    status === 404 || (code !== null && FORUM_CHANNEL_CODES.has(code));
  return httpFailure(response, (status) =>
    webhookRejected(status) ? 'auth' : classifyStatus(status),
  );
}

/** The `code` of a Discord JSON error body, read from a clone of the response. */
async function jsonCode(response: Response): Promise<number | null> {
  try {
    const { code } = (await response.clone().json()) as { code?: unknown };
    return typeof code === 'number' ? code : null;
  } catch {
    return null;
  }
}

function discordBody({ isTest, project, feedback }: OutgoingDelivery) {
  const type = FEEDBACK_TYPE_LABELS[feedback.resolvedType];
  const title = `${isTest ? 'Test · ' : ''}${type} · ${escapeMarkdown(project.name)}`;
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(title, TITLE_MAX),
        ...(feedback.dashboardUrl ? { url: feedback.dashboardUrl } : {}),
        description: codeBlock(feedback.text),
        timestamp: feedback.receivedAt.toISOString(),
        color: COLORS[feedback.severity ?? 'none'],
        fields: [
          { name: 'Type', value: type, inline: true },
          {
            name: 'Severity',
            value: feedback.severity ? SEVERITY_LABELS[feedback.severity] : 'Not assessed',
            inline: true,
          },
          {
            name: 'Project',
            value: truncate(escapeMarkdown(project.name), FIELD_MAX),
            inline: true,
          },
        ],
        footer: { text: feedback.uncertain ? 'nudge · Uncertain verdict' : 'nudge' },
      },
    ],
  };
}

/**
 * The alert as one embed: title and details written by nudge, where the names (typed
 * by a Member) and the refusal (worded by the target) are escaped like the Project name.
 */
function alertBody(alert: Alert) {
  return noticeBody(presentAlert(alert), {
    footer: alert.isTest ? 'nudge · test alert' : 'nudge · alert',
    dashboardUrl: alert.dashboardUrl,
    at: alert.at,
  });
}

/** The summary of Held Incidents, as one embed like an alert, timed at the last opening. */
function heldSummaryBody(summary: OutgoingHeldSummary) {
  return noticeBody(presentHeldSummary(summary), {
    footer: 'nudge · Incidents held',
    dashboardUrl: summary.dashboardUrl,
    at: summary.held.lastOpenedAt,
  });
}

/** A message written by nudge (alert, summary of Held Incidents) as one embed. */
function noticeBody(
  { title, summary, details }: PresentedAlert,
  { footer, dashboardUrl, at }: { footer: string; dashboardUrl: string | null; at: Date },
) {
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(escapeMarkdown(title), TITLE_MAX),
        ...(isSafeLink(dashboardUrl) ? { url: dashboardUrl } : {}),
        description: summary,
        timestamp: at.toISOString(),
        color: ALERT_COLOR,
        fields: details.map(({ label, value, long }) => ({
          name: label,
          value: truncate(escapeMarkdown(value), FIELD_MAX),
          inline: !long,
        })),
        footer: { text: footer },
      },
    ],
  };
}

/**
 * An Incident as one embed: the text of the sender escaped like the Project name, the
 * long details (message, context) at full width.
 */
function incidentBody(delivery: OutgoingIncidentDelivery | OutgoingIncidentClosing) {
  const { title, summary, details } = presentIncident(delivery);
  const { incident } = delivery;
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(escapeMarkdown(title), TITLE_MAX),
        ...(isSafeLink(incident.dashboardUrl) ? { url: incident.dashboardUrl } : {}),
        description: truncate(escapeMarkdown(summary), DESCRIPTION_MAX),
        timestamp: (incident.closure?.closedAt ?? incident.firstSeenAt).toISOString(),
        color: incident.closure ? CLOSED_COLOR : LEVEL_COLORS[incident.level],
        fields: details.map(({ label, value, long }) => ({
          name: label,
          value: truncate(escapeMarkdown(value), FIELD_MAX),
          inline: !long,
        })),
        footer: { text: 'nudge · Incident' },
      },
    ],
  };
}

const ALERT_COLOR = 0xf1c40f;

/** Embed stripe of an Open Incident, from blue (info) to red (critical); green once Closed. */
const LEVEL_COLORS: Readonly<Record<Level, number>> = {
  info: 0x3498db,
  warning: 0xf1c40f,
  error: 0xe67e22,
  critical: 0xe74c3c,
};
const CLOSED_COLOR = 0x2ecc71;

/** Embed stripe, from grey (cosmetic) to red (blocking). */
const COLORS: Readonly<Record<Severity | 'none', number>> = {
  none: 0x99aab5,
  cosmetic: 0x95a5a6,
  minor: 0x3498db,
  major: 0xe67e22,
  blocking: 0xe74c3c,
};

/** Embed limits (docs.discord.com/developers/resources/message#embed-limits). */
const TITLE_MAX = 256;
const DESCRIPTION_MAX = 4096;
const FIELD_MAX = 1024;

const ZERO_WIDTH = '​';
const OPENING = '```\n';
const CLOSING = '\n```';

/**
 * The Author's text in a code block: Discord interprets no markdown, link or mention
 * there. A run of backticks is broken by a zero-width space, so the text never closes
 * the block; `@everyone` and `@here` are too, in case the text escaped the block.
 */
function codeBlock(text: string): string {
  const encoded = neutralizeBroadMentions(text).replace(/`(?=`)/g, `\`${ZERO_WIDTH}`);
  return `${OPENING}${truncate(encoded, DESCRIPTION_MAX - OPENING.length - CLOSING.length)}${CLOSING}`;
}

/** A Member's text (Project name) shown as is in a markdown title or field. */
function escapeMarkdown(text: string): string {
  return neutralizeBroadMentions(text).replace(/[\\`*_~|>[\]()<#-]/g, '\\$&');
}

const neutralizeBroadMentions = (text: string) =>
  text.replace(/@(everyone|here)/gi, `@${ZERO_WIDTH}$1`);
