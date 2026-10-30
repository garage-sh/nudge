/**
 * Recorded HTTP responses of the Telegram Bot API, for the Telegram adapter's contract
 * test.
 *
 * Each recording says where it comes from:
 * - `documentation`: shape and values described by the documentation (URL in `source`);
 * - `reconstructed`: written for our Delivery following the documented shape (the
 *   `Message`, `User` and `ChatFullInfo` objects, the error envelope), with the error
 *   descriptions Telegram is known to return, which the documentation does not list.
 *
 * Every answer is a JSON envelope: `{ "ok": true, "result": … }`, or `{ "ok": false,
 * "error_code", "description", "parameters"? }` with the HTTP status equal to
 * `error_code` (https://core.telegram.org/bots/api#making-requests). None was obtained
 * through a real call: the documented schema is authoritative. Read on 2026-10-30.
 */

export interface Recording {
  readonly provenance: 'documentation' | 'reconstructed';
  readonly source: string;
  readonly status: number;
  readonly body?: unknown;
}

const REQUESTS = 'https://core.telegram.org/bots/api#making-requests';
const MESSAGE = 'https://core.telegram.org/bots/api#message';
const GET_ME = 'https://core.telegram.org/bots/api#getme';
const GET_CHAT = 'https://core.telegram.org/bots/api#getchat';
const RESPONSE_PARAMETERS = 'https://core.telegram.org/bots/api#responseparameters';

/** The tests' bot: `<bot id>:<secret>`, shaped like BotFather's example. */
export const BOT_ID = 4839574812;
export const BOT_TOKEN = `${BOT_ID}:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw8`;
/** A private supergroup: `-100` then its id, which its `t.me/c/` links carry. */
export const SUPERGROUP_ID = -1001234567890;
export const MESSAGE_ID = 2187;

const failure = (status: number, description: string, parameters?: unknown): Recording => ({
  provenance: 'reconstructed',
  source: REQUESTS,
  status,
  body: {
    ok: false,
    error_code: status,
    description,
    ...(parameters === undefined ? {} : { parameters }),
  },
});

/** A `Message` the bot posted in `chat`: the result of `sendMessage` or `sendPhoto`. */
const posted = (chat: Record<string, unknown>, extra: Record<string, unknown> = {}): Recording => ({
  provenance: 'reconstructed',
  source: MESSAGE,
  status: 200,
  body: {
    ok: true,
    result: {
      message_id: MESSAGE_ID,
      from: { id: BOT_ID, is_bot: true, first_name: 'nudge', username: 'nudge_shop_bot' },
      chat,
      date: 1792834200,
      text: 'Bug · Shop',
      ...extra,
    },
  },
});

export const TELEGRAM = {
  /** Posted in a private supergroup: linkable as `https://t.me/c/1234567890/<message>`. */
  postedInSupergroup: posted({ id: SUPERGROUP_ID, title: 'Shop bugs', type: 'supergroup' }),
  /** Posted in a public channel: linkable as `https://t.me/<username>/<message>`. */
  postedInPublicChannel: posted({
    id: -1009876543210,
    title: 'Shop status',
    username: 'shop_status',
    type: 'channel',
  }),
  /** Posted in a private chat with a person: no link reaches it. */
  postedInPrivateChat: posted({ id: 123456789, first_name: 'Ada', type: 'private' }),
  /** Posted in a basic group: no link reaches it. */
  postedInGroup: posted({ id: -4012345678, title: 'Shop team', type: 'group' }),
  /** `getMe`: "Returns basic information about the bot in form of a User object." */
  me: {
    provenance: 'documentation',
    source: GET_ME,
    status: 200,
    body: {
      ok: true,
      result: {
        id: BOT_ID,
        is_bot: true,
        first_name: 'nudge',
        username: 'nudge_shop_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
      },
    },
  },
  /** `getChat`: "Returns a ChatFullInfo object on success." */
  chat: {
    provenance: 'documentation',
    source: GET_CHAT,
    status: 200,
    body: {
      ok: true,
      result: {
        id: SUPERGROUP_ID,
        type: 'supergroup',
        title: 'Shop bugs',
        accent_color_id: 0,
        max_reaction_count: 11,
      },
    },
  },
  /** A token BotFather revoked, or never issued. */
  unauthorized: failure(401, 'Unauthorized'),
  /** The bot was removed from the group, or the person blocked it. */
  kicked: failure(403, 'Forbidden: bot was kicked from the supergroup chat'),
  blocked: failure(403, 'Forbidden: bot was blocked by the user'),
  /** A `chat_id` the bot cannot see: wrong id, or a person who never started the bot. */
  chatNotFound: failure(400, 'Bad Request: chat not found'),
  /** The configured forum topic was deleted. */
  threadNotFound: failure(400, 'Bad Request: message thread not found'),
  /** A body this message alone gets wrong. */
  badEntities: failure(
    400,
    'Bad Request: can\'t parse entities: Unsupported start tag "x" at byte offset 0',
  ),
  /** "In case of exceeding flood control, the number of seconds left to wait." */
  rateLimited: {
    ...failure(429, 'Too Many Requests: retry after 3', { retry_after: 3 }),
    provenance: 'documentation',
    source: RESPONSE_PARAMETERS,
  },
  rateLimitedLong: {
    ...failure(429, 'Too Many Requests: retry after 40', { retry_after: 40 }),
    provenance: 'documentation',
    source: RESPONSE_PARAMETERS,
  },
  badGateway: failure(502, 'Bad Gateway'),
} as const satisfies Record<string, Recording>;
