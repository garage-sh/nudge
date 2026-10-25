/**
 * Recorded HTTP responses of the Discord API, for the Discord adapter's contract test.
 *
 * Each recording says where it comes from:
 * - `documentation`: body copied from the documentation's example (URL in `source`);
 * - `reconstructed`: written for our Delivery, or for an error whose body has no
 *   example, following the documented shape (schema URL in `source`).
 *
 * None was obtained through a real call: the documented schema is authoritative.
 * Documentation read on 2026-10-24.
 */

export interface Recording {
  readonly provenance: 'documentation' | 'reconstructed';
  readonly source: string;
  readonly status: number;
  /** Absent: response without a body (204). */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

const WEBHOOK = 'https://docs.discord.com/developers/resources/webhook';
const MESSAGE = 'https://docs.discord.com/developers/resources/message';
const CODES = 'https://docs.discord.com/developers/topics/opcodes-and-status-codes';
const RATE_LIMITS = 'https://docs.discord.com/developers/topics/rate-limits';

/** The tests' channel webhook: `https://discord.com/api/webhooks/<id>/<token>`. */
export const WEBHOOK_ID = '223704706495545344';
export const WEBHOOK_TOKEN =
  '3d89bb7572e0fb30d8128367b3b1b44fecd1726de135cbe28a41f8b2f777c372ba2939e72279b94526ff5d1bd4358d65cf11';
export const CHANNEL_ID = '199737254929760256';
export const GUILD_ID = '199737254929760256';
export const MESSAGE_ID = '334385199974967042';

export const DISCORD = {
  /**
   * Execute Webhook with `?wait=true`: "returns the created message body". Shape of
   * the Message object (required fields), ids from the documentation's example.
   */
  createdMessage: {
    provenance: 'reconstructed',
    source: `${MESSAGE}#message-object`,
    status: 200,
    body: {
      id: MESSAGE_ID,
      type: 0,
      content: '',
      channel_id: CHANNEL_ID,
      author: { id: WEBHOOK_ID, username: 'nudge', avatar: null, discriminator: '0000', bot: true },
      attachments: [],
      embeds: [{ type: 'rich', title: 'Bug · Shop' }],
      mentions: [],
      mention_roles: [],
      pinned: false,
      mention_everyone: false,
      tts: false,
      timestamp: '2026-10-24T09:30:00.299000+00:00',
      edited_timestamp: null,
      flags: 0,
      components: [],
      webhook_id: WEBHOOK_ID,
    },
  },
  /**
   * Get Webhook with Token: the Webhook object "without user". The documentation's
   * "Example Incoming Webhook" example, `user` removed.
   */
  webhook: {
    provenance: 'documentation',
    source: `${WEBHOOK}#get-webhook-with-token`,
    status: 200,
    body: {
      name: 'test webhook',
      type: 1,
      channel_id: CHANNEL_ID,
      token: WEBHOOK_TOKEN,
      avatar: null,
      guild_id: GUILD_ID,
      id: WEBHOOK_ID,
      application_id: null,
    },
  },
  /** 401 "Invalid webhook token provided" (JSON code 50027). */
  invalidToken: {
    provenance: 'reconstructed',
    source: CODES,
    status: 401,
    body: { message: 'Invalid Webhook Token', code: 50027 },
  },
  /**
   * 404 "Unknown webhook" (JSON code 10015): the webhook was deleted. "If a webhook
   * returns a 404 status you should not attempt to use it again" (rate-limits).
   */
  unknownWebhook: {
    provenance: 'reconstructed',
    source: CODES,
    status: 404,
    body: { message: 'Unknown Webhook', code: 10015 },
  },
  /** 400 "Invalid form body" (JSON code 50035), with the `errors` detail. */
  invalidBody: {
    provenance: 'reconstructed',
    source: CODES,
    status: 400,
    body: {
      message: 'Invalid Form Body',
      code: 50035,
      errors: {
        embeds: {
          '0': {
            description: {
              _errors: [
                { code: 'BASE_TYPE_MAX_LENGTH', message: 'Must be 4096 or fewer in length.' },
              ],
            },
          },
        },
      },
    },
  },
  /** 429: body from the documentation's example, `Retry-After` header. */
  rateLimited: {
    provenance: 'documentation',
    source: RATE_LIMITS,
    status: 429,
    headers: { 'retry-after': '65', 'x-ratelimit-scope': 'shared' },
    body: { message: 'You are being rate limited.', retry_after: 64.57, global: false },
  },
  /**
   * 400 JSON code 220001 "Webhooks posted to forum channels must have a thread_name or
   * thread_id": the webhook belongs to a forum channel.
   */
  forumChannel: {
    provenance: 'reconstructed',
    source: CODES,
    status: 400,
    body: {
      message: 'Webhooks posted to forum channels must have a thread_name or thread_id',
      code: 220001,
    },
  },
  /** 502 "There was not a gateway available to process your request". */
  gatewayUnavailable: {
    provenance: 'reconstructed',
    source: CODES,
    status: 502,
    body: { message: '502: Bad Gateway', code: 0 },
  },
} as const satisfies Record<string, Recording>;
