import { z } from 'zod';
import type { DestinationDefinition } from './definition.js';

/**
 * Hosts from which Slack issues an incoming webhook URL: `hooks.slack.com`, or
 * `hooks.slack-gov.com` for GovSlack
 * (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks).
 */
const SLACK_HOSTS = ['hooks.slack.com', 'hooks.slack-gov.com'];

/** `/services/<workspace>/<webhook>/<token>`: `T00000000/B00000000/XXXX…`. */
const WEBHOOK_PATH = /^\/services\/([A-Z0-9]{1,30})\/([A-Z0-9]{1,30})\/([A-Za-z0-9]{1,100})\/?$/;

/**
 * The canonical URL of a Slack incoming webhook, or `null` if the value is not one
 * (https, Slack host, no parameters). Workflow Builder webhooks (`/triggers/…`) expect
 * a different body: they are not accepted.
 */
export function parseSlackWebhook(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!SLACK_HOSTS.includes(url.hostname) || url.search || url.hash) return null;
  const parts = WEBHOOK_PATH.exec(url.pathname);
  return parts ? `https://${url.hostname}/services/${parts.slice(1, 4).join('/')}` : null;
}

/**
 * Slack: an incoming webhook, bound to a channel. Its URL carries the token that allows
 * posting: it is a secret, encrypted in the database and never returned. No
 * configuration in clear (the channel is set by the webhook).
 */
export const slackDefinition = {
  config: z.strictObject({}),
  secrets: z.strictObject({
    url: z
      .string()
      .trim()
      .refine((value) => parseSlackWebhook(value) !== null, {
        message: 'Expected a Slack incoming webhook URL (https://hooks.slack.com/services/…)',
      }),
  }),
  generatedSecrets: [],
} as const satisfies DestinationDefinition;

export type SlackSecrets = z.output<typeof slackDefinition.secrets>;
