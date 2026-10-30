import {
  presentAlert,
  presentHeldSummary,
  presentIncident,
  type ConfiguredDestination,
  type DeliveryResult,
  type DestinationAdapter,
  type FailureClass,
  type OutgoingDelivery,
  type OutgoingIncident,
  type PresentedMessage,
} from '@nudge/core';
import {
  FEEDBACK_TYPE_LABELS,
  SEVERITY_LABELS,
  isTelegramBotToken,
  telegramDefinition,
  type TelegramSecrets,
} from '@nudge/shared';
import { readCapture, type CaptureImage } from './capture.js';
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  EXCERPT_MAX,
  classifyStatus,
  externalLink,
  httpFailure,
  networkFailure,
} from './http.js';
import { isSafeLink } from './markdown.js';
import { authorIdentity, escapeHtml, truncate } from './text.js';

export interface TelegramOptions {
  readonly fetch?: typeof globalThis.fetch;
  /** Bot API response timeout, beyond which the call is a transient failure. */
  readonly timeoutMs?: number;
  /**
   * Longest `retry_after` the adapter waits out before sending again, once; beyond it,
   * the call is a transient failure and the job's own retries take over.
   */
  readonly maxRetryWaitMs?: number;
  /** How the adapter waits (tests: no wait). */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRY_WAIT_MS = 5_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A call's outcome: Telegram's `result`, or the classified failure. */
type Answer =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly failureClass: FailureClass; readonly message: string };

/**
 * Telegram: messages a bot posts in one chat (private chat, group, supergroup or
 * channel), through the Bot API (https://core.telegram.org/bots/api). The host is fixed;
 * the bot token goes in the path of every call.
 */
export function telegramAdapter(
  destination: ConfiguredDestination,
  options: TelegramOptions = {},
): DestinationAdapter {
  const token = (destination.secrets as Partial<TelegramSecrets>).botToken?.trim() ?? '';
  if (!isTelegramBotToken(token))
    throw new Error(`Telegram ${destination.id} has no valid bot token`);
  const config = telegramDefinition.config.safeParse(destination.config);
  if (!config.success) throw new Error(`Telegram ${destination.id} has no valid chat`);
  const { chatId, topicId } = config.data;
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const maxRetryWaitMs = options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;
  const sleep = options.sleep ?? wait;
  const api = `https://api.telegram.org/bot${token}`;

  /** Where every message goes: the chat, and its forum topic when one is configured. */
  const target = { chat_id: chatId, ...(topicId === null ? {} : { message_thread_id: topicId }) };

  /** A Bot API method, called once more after a `retry_after` short enough to wait out. */
  async function request(
    method: string,
    payload: Record<string, unknown> | FormData,
    retried = false,
  ): Promise<Answer> {
    let response: Response;
    try {
      response = await fetch(`${api}/${method}`, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        ...(payload instanceof FormData
          ? { body: payload }
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
      });
    } catch (error) {
      const { failureClass, message } = networkFailure(error);
      // The token is in the URL path: a fetch that names the URL in its error must not
      // carry it into lastError or the logs.
      return { ok: false, failureClass, message: message.replaceAll(token, '<bot token>') };
    }
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { result?: unknown };
      return { ok: true, result: body.result };
    }
    const error = await errorBody(response);
    const retryAfterMs = response.status === 429 ? retryAfter(error) : null;
    if (!retried && retryAfterMs !== null && retryAfterMs <= maxRetryWaitMs) {
      await response.body?.cancel();
      await sleep(retryAfterMs);
      return request(method, payload, true);
    }
    return { ok: false, ...(await telegramFailure(response, error)) };
  }

  /** Posts a message: delivered with its link when Telegram allows one, or the failure. */
  async function post(
    text: string,
    reply: number | null = null,
  ): Promise<{ answer: Answer; result: DeliveryResult }> {
    const answer = await request('sendMessage', {
      ...target,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(reply === null
        ? {}
        : { reply_parameters: { message_id: reply, allow_sending_without_reply: true } }),
    });
    return { answer, result: asDeliveryResult(answer) };
  }

  /** Posts the Capture with the message as its caption: one message, like without one. */
  async function postPhoto(image: CaptureImage, caption: string): Promise<DeliveryResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(target)) form.set(key, String(value));
    form.set('caption', caption);
    form.set('parse_mode', 'HTML');
    const extension = image.contentType === 'image/png' ? 'png' : 'jpg';
    form.set('photo', new Blob([image.bytes], { type: image.contentType }), `capture.${extension}`);
    return asDeliveryResult(await request('sendPhoto', form));
  }

  /** A message that no Delivery keeps the link of (alert, summary). */
  const notify = async (text: string): Promise<DeliveryResult> => {
    const { result } = await post(text);
    return result.status === 'delivered' ? { status: 'delivered', externalUrl: null } : result;
  };

  return {
    async send(delivery) {
      const capture = await readCapture(delivery.feedback.capture);
      if (!capture.ok) return { status: 'failed', ...capture };
      if (capture.image && capture.image.bytes.length <= PHOTO_MAX_BYTES) {
        const result = await postPhoto(capture.image, feedbackHtml(delivery, CAPTION_MAX));
        // A photo refused on its own (dimensions, media rights): the message goes without it.
        if (result.status === 'delivered' || result.failureClass !== 'permanent') return result;
      }
      return (await post(feedbackHtml(delivery, MESSAGE_MAX))).result;
    },
    /** The message's link is what finds it again to reply to it on closing. */
    deliverIncident: async (delivery) => (await post(incidentHtml(delivery))).result,
    /**
     * Replies to the opening message, so the chat reads as one story. Without its link
     * (a private chat or a basic group, which Telegram gives none), the closing is a
     * message of its own, titled "Closed · …".
     */
    async closeIncident(closing) {
      const { result } = await post(
        incidentHtml(closing),
        messageIdOf(closing.opening.externalUrl),
      );
      return result.status === 'delivered'
        ? { status: 'delivered', externalUrl: closing.opening.externalUrl }
        : result;
    },
    summarizeHeld: (summary) =>
      notify(
        noticeHtml(presentHeldSummary(summary), {
          footer: 'nudge · Incidents held',
          link: { url: summary.dashboardUrl, label: 'View the Held Incidents in nudge' },
        }),
      ),
    alert: (alert) =>
      notify(
        noticeHtml(presentAlert(alert), {
          footer: alert.isTest ? 'nudge · test alert' : 'nudge · alert',
          link: { url: alert.dashboardUrl, label: 'Open in nudge' },
        }),
      ),
    /**
     * `getMe` checks the token, then `getChat` the bot's access to the chat: nothing is
     * posted.
     */
    async healthCheck() {
      for (const [method, payload] of [
        ['getMe', {}],
        ['getChat', { chat_id: chatId }],
      ] as const) {
        const answer = await request(method, payload);
        if (!answer.ok) {
          return { reachable: false, failureClass: answer.failureClass, message: answer.message };
        }
      }
      return { reachable: true };
    },
  };
}

/** A posted message as a Delivery result: delivered with its link, or the failure. */
function asDeliveryResult(answer: Answer): DeliveryResult {
  if (!answer.ok) {
    return { status: 'failed', failureClass: answer.failureClass, message: answer.message };
  }
  return { status: 'delivered', externalUrl: messageLink(answer.result) };
}

interface SentMessage {
  readonly message_id?: unknown;
  readonly chat?: { readonly id?: unknown; readonly type?: unknown; readonly username?: unknown };
}

/** A public chat's username, as it appears in its `t.me` links. */
const USERNAME = '[A-Za-z0-9_]{4,32}';

/**
 * The link of a posted message, which Telegram allows only in supergroups and
 * channels: `https://t.me/<username>/<message>` when public, `https://t.me/c/<id>/<message>`
 * (the id without its `-100`) otherwise. A private chat or a basic group has none.
 */
function messageLink(result: unknown): string | null {
  const { message_id: messageId, chat } = (result ?? {}) as SentMessage;
  if (!Number.isSafeInteger(messageId) || (chat?.type !== 'supergroup' && chat?.type !== 'channel'))
    return null;
  if (typeof chat.username === 'string' && new RegExp(`^${USERNAME}$`).test(chat.username)) {
    return externalLink(`https://t.me/${chat.username}/${String(messageId)}`);
  }
  const id = typeof chat.id === 'number' ? String(chat.id) : '';
  return /^-100\d+$/.test(id)
    ? externalLink(`https://t.me/c/${id.slice(4)}/${String(messageId)}`)
    : null;
}

/** The id of the message a link of this adapter points at, or `null`. */
function messageIdOf(link: string | null): number | null {
  const match = link
    ? new RegExp(`^https://t\\.me/(?:c/\\d+|${USERNAME})/(\\d+)$`).exec(link)
    : null;
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}

interface ErrorBody {
  readonly description?: unknown;
  readonly parameters?: { readonly retry_after?: unknown };
}

/** The Bot API's error envelope, read from a clone of the response, or `{}`. */
async function errorBody(response: Response): Promise<ErrorBody> {
  try {
    return ((await response.clone().json()) as ErrorBody | null) ?? {};
  } catch {
    return {};
  }
}

/** `parameters.retry_after`, in milliseconds, or `null`. */
function retryAfter({ parameters }: ErrorBody): number | null {
  const seconds = parameters?.retry_after;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : null;
}

/**
 * Descriptions of a 400 that rejects the Destination's configuration, not this message:
 * the chat, its forum topic or the bot's rights are gone, or the group became a
 * supergroup under a new id. The Destination is then Suspended rather than each
 * Delivery failing.
 */
const REJECTED_CHAT =
  /chat not found|message thread not found|upgraded to a supergroup|not enough rights to send text|need administrator rights|have no rights to send a message/i;

/**
 * Class and message of a Bot API refusal. 401 (token revoked), 403 (bot removed from
 * the chat, or blocked by the person), 404 (no such bot) and a 400 that rejects the
 * chat are `auth`: only a configuration change fixes them. 429 and 5xx are transient;
 * any other 400 targets this message.
 */
async function telegramFailure(
  response: Response,
  { description }: ErrorBody,
): Promise<{ failureClass: FailureClass; message: string }> {
  const text = typeof description === 'string' ? description : '';
  const classify = (status: number): FailureClass =>
    status === 404 || (status === 400 && REJECTED_CHAT.test(text))
      ? 'auth'
      : classifyStatus(status);
  // A redirect, or an answer that is not the Bot API's envelope: the shared reading.
  if (!text || (response.status >= 300 && response.status < 400)) {
    return httpFailure(response, classify);
  }
  await response.body?.cancel();
  return {
    failureClass: classify(response.status),
    message: `HTTP ${response.status}: ${truncate(text, EXCERPT_MAX)}`,
  };
}

/** Largest photo `sendPhoto` takes (https://core.telegram.org/bots/api#sendphoto). */
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** Message limits: 4096 characters of text, 1024 of caption, once entities are parsed. */
const MESSAGE_MAX = 4096;
const CAPTION_MAX = 1024;
/** Bound of a title and of a short detail's value. */
const TITLE_MAX = 200;
const VALUE_MAX = 100;

/** A piece of Telegram HTML, with the length Telegram counts: its text once parsed. */
interface Html {
  readonly html: string;
  readonly length: number;
}

const ZERO_WIDTH = '​';

/**
 * A text from outside nudge (the sender, a Member, a target) shown as is: escaped, so
 * it forms no tag, and `@` broken before a name so that it mentions nobody.
 */
const external = (raw: string, max: number): Html => {
  const text = truncate(raw.replace(/(^|[^\w])@(?=\w)/g, `$1@${ZERO_WIDTH}`), max);
  return { html: escapeHtml(text), length: text.length };
};

/** Escaped text in a `<pre>` block: Telegram detects no mention, link or command there. */
const preformatted = (raw: string, max: number): Html => {
  const text = truncate(raw, Math.max(1, max));
  return { html: `<pre>${escapeHtml(text)}</pre>`, length: text.length };
};

const bold = (inner: Html): Html => ({ html: `<b>${inner.html}</b>`, length: inner.length });

/** A text written by nudge, escaped all the same. */
const plain = (text: string): Html => ({ html: escapeHtml(text), length: text.length });

const concat = (...parts: Html[]): Html => ({
  html: parts.map((part) => part.html).join(''),
  length: parts.reduce((sum, part) => sum + part.length, 0),
});

interface Message {
  readonly title: string;
  readonly summary?: string;
  /** The Author's text, right below the title. */
  readonly quote?: string;
  readonly details: PresentedMessage['details'];
  readonly footer: string;
  readonly link: { readonly url: string | null; readonly label: string };
}

/**
 * A message in Telegram's HTML: its title in bold, the summary, the Author's text and
 * the long details in `<pre>` blocks, the short details as "label: value", then the
 * footer and the dashboard link. The `<pre>` blocks share what `max` leaves them.
 */
function html({ title, summary, quote, details, footer, link }: Message, max: number): string {
  const short = details.filter((detail) => !detail.long);
  const long = details.filter((detail) => detail.long);
  const head = [
    bold(external(title, TITLE_MAX)),
    ...(summary === undefined ? [] : [external(summary, MESSAGE_MAX)]),
  ];
  const fields = short.map(({ label, value }) =>
    concat(bold(plain(label)), plain(': '), external(value, VALUE_MAX)),
  );
  const labels = long.map(({ label }) => bold(plain(label)));
  const footerLine = isSafeLink(link.url)
    ? concat(plain(`${footer} · `), {
        html: `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`,
        length: link.label.length,
      })
    : plain(footer);
  const fixed = [...head, ...fields, ...labels, footerLine];
  const blockCount = long.length + (quote === undefined ? 0 : 1);
  // One line break between two parts.
  const room = max - (fixed.length + blockCount - 1) - fixed.reduce((sum, p) => sum + p.length, 0);
  const block = (text: string) => preformatted(text, Math.floor(room / Math.max(1, blockCount)));
  return [
    ...head,
    ...(quote === undefined ? [] : [block(quote)]),
    ...fields,
    ...long.flatMap(({ value }, index) => [labels[index]!, block(value)]),
    footerLine,
  ]
    .map((part) => part.html)
    .join('\n');
}

function feedbackHtml({ isTest, project, feedback }: OutgoingDelivery, max: number): string {
  const type = FEEDBACK_TYPE_LABELS[feedback.resolvedType];
  const author = authorIdentity(feedback.author);
  return html(
    {
      title: `${isTest ? 'Test · ' : ''}${type} · ${project.name}`,
      quote: feedback.text,
      details: [
        { label: 'Type', value: type },
        {
          label: 'Severity',
          value: feedback.severity ? SEVERITY_LABELS[feedback.severity] : 'Not assessed',
        },
        ...(author
          ? [
              {
                label: 'Author',
                value: `${author}${feedback.author?.trust === 'attested' ? ' · attested' : ''}`,
              },
            ]
          : []),
        { label: 'Project', value: project.name },
      ],
      footer: feedback.uncertain ? 'nudge · Uncertain verdict' : 'nudge',
      link: { url: feedback.dashboardUrl, label: 'View the feedback in nudge' },
    },
    max,
  );
}

/** An Incident: every text of the sender is escaped, its message and context in blocks. */
function incidentHtml(delivery: OutgoingIncident): string {
  return html(
    {
      ...presentIncident(delivery),
      footer: 'nudge · Incident',
      link: { url: delivery.incident.dashboardUrl, label: 'View the Incident in nudge' },
    },
    MESSAGE_MAX,
  );
}

/** A message written by nudge (alert, summary of Held Incidents). */
function noticeHtml(
  presented: PresentedMessage,
  { footer, link }: Pick<Message, 'footer' | 'link'>,
): string {
  return html({ ...presented, footer, link }, MESSAGE_MAX);
}
