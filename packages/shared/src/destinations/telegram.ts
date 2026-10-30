import { z } from 'zod';
import type { DestinationDefinition } from './definition.js';

/**
 * A bot token as BotFather issues it: the bot's numeric id, a colon, then a secret of
 * letters, digits, `_` and `-` (https://core.telegram.org/bots/api#authorizing-your-bot).
 * The token goes in the path of every Bot API call: nothing else may slip in.
 */
const BOT_TOKEN = /^\d{1,20}:[A-Za-z0-9_-]{30,100}$/;

/**
 * A `chat_id`: the numeric id of a private chat, a group, a supergroup or a channel
 * (negative for groups, `-100…` for supergroups and channels), or the `@username` of a
 * public channel (https://core.telegram.org/bots/api#sendmessage).
 */
const CHAT_ID = /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;

/** Whether a value has the shape of a Telegram bot token. */
export const isTelegramBotToken = (value: string): boolean => BOT_TOKEN.test(value.trim());

/**
 * Telegram: messages posted by a bot in one chat, through the Bot API. The bot token
 * is a secret (encrypted in the database, never returned); the chat and the optional
 * forum topic (`message_thread_id`) are configuration in clear. The Bot API host is
 * fixed: no outbound URL comes from the Member.
 */
export const telegramDefinition = {
  config: z.strictObject({
    chatId: z.string().trim().regex(CHAT_ID, {
      message:
        'Expected a Telegram chat id (a number such as -1001234567890) or a public channel’s @username',
    }),
    /** The forum topic every message goes to; `null`: the chat itself. */
    topicId: z
      .number()
      .int({ message: 'Expected a topic id (a whole number)' })
      .min(1, { message: 'Expected a topic id (a whole number)' })
      .max(2 ** 31 - 1)
      .nullable()
      .default(null),
  }),
  secrets: z.strictObject({
    botToken: z.string().trim().refine(isTelegramBotToken, {
      message: 'Expected a Telegram bot token from BotFather (123456789:AA…)',
    }),
  }),
  generatedSecrets: [],
} as const satisfies DestinationDefinition;

export type TelegramConfig = z.output<typeof telegramDefinition.config>;
export type TelegramSecrets = z.output<typeof telegramDefinition.secrets>;
