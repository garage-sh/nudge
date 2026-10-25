import { z } from 'zod';
import type { DestinationDefinition } from './definition.js';

/** Hosts from which Discord issues a webhook URL ("Copy Webhook URL"). */
const DISCORD_HOSTS = ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'];

/** `/api[/v<n>]/webhooks/<id>/<token>`: the id is a snowflake, the token a secret. */
const WEBHOOK_PATH = /^\/api(?:\/v\d+)?\/webhooks\/(\d{1,20})\/([\w-]{1,200})\/?$/;

export interface DiscordWebhook {
  readonly id: string;
  readonly token: string;
}

/**
 * The id and token of a Discord channel webhook URL, or `null` if the URL is not one
 * (https, Discord host, no parameters: a `thread_id` is not supported).
 */
export function parseDiscordWebhook(value: string): DiscordWebhook | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!DISCORD_HOSTS.includes(url.hostname) || url.search || url.hash) return null;
  const parts = WEBHOOK_PATH.exec(url.pathname);
  return parts ? { id: parts[1]!, token: parts[2]! } : null;
}

/**
 * Discord: a channel webhook. Its URL carries the token that allows posting: it is a
 * secret, encrypted in the database and never returned. No configuration in clear.
 */
export const discordDefinition = {
  config: z.strictObject({}),
  secrets: z.strictObject({
    url: z
      .string()
      .trim()
      .refine((value) => parseDiscordWebhook(value) !== null, {
        message: 'Expected a Discord webhook URL (https://discord.com/api/webhooks/…)',
      }),
  }),
  generatedSecrets: [],
} as const satisfies DestinationDefinition;

export type DiscordSecrets = z.output<typeof discordDefinition.secrets>;
