import type { ConfiguredDestination, DestinationAdapterResolver, Mailer } from '@nudge/core';
import { isDestinationType, type DestinationType } from '@nudge/shared';
import { discordAdapter } from './discord.js';
import { emailAdapter } from './email.js';
import { gitHubAdapter } from './github.js';
import { linearAdapter } from './linear.js';
import { guardedFetch, STRICT_OUTBOUND_POLICY } from './outbound.js';
import { slackAdapter } from './slack.js';
import { smtpMailer } from './smtp.js';
import { webhookAdapter } from './webhook.js';

export { discordAdapter, type DiscordOptions } from './discord.js';
export { emailAdapter, type EmailOptions } from './email.js';
export { alertEmail, feedbackEmail, smtpTestEmail } from './email-template.js';
export { gitHubAdapter, type GitHubOptions } from './github.js';
export { linearAdapter, type LinearOptions } from './linear.js';
export {
  guardedFetch,
  isPublicAddress,
  outboundPolicyFromEnv,
  OutboundRefusedError,
  OUTBOUND_ALLOWED_HOSTS_VARIABLE,
  resolveAllowedAddress,
  STRICT_OUTBOUND_POLICY,
  type OutboundPolicy,
} from './outbound.js';
export { slackAdapter, type SlackOptions } from './slack.js';
export { smtpMailer, smtpFailure, type SmtpMailerOptions } from './smtp.js';
export { webhookAdapter, type WebhookOptions } from './webhook.js';

/** What every adapter of the registry receives. */
export interface DestinationAdapterOptions {
  /** HTTP client of every call: `guardedFetch` (the URLs come from Members). */
  readonly fetch: typeof globalThis.fetch;
  /** The Instance's SMTP server, for the email Destinations: `smtpMailer`. */
  readonly mailer: Mailer;
}

type AdapterFactory = (
  destination: ConfiguredDestination,
  options: DestinationAdapterOptions,
) => ReturnType<DestinationAdapterResolver>;

/**
 * Registry of the Instance's Destination adapters, one per type declared in
 * `DESTINATION_DEFINITIONS` (@nudge/shared): the compiler requires one entry per type.
 */
export const DESTINATION_ADAPTERS: Readonly<Record<DestinationType, AdapterFactory>> = {
  webhook: webhookAdapter,
  discord: discordAdapter,
  linear: linearAdapter,
  slack: slackAdapter,
  github: gitHubAdapter,
  email: emailAdapter,
};

export class UnknownDestinationTypeError extends Error {
  override readonly name = 'UnknownDestinationTypeError';
  constructor(readonly destination: ConfiguredDestination) {
    super(`No adapter for Destination type "${destination.type}"`);
  }
}

/** The adapter of each Destination, calling out through `options.fetch`. */
export function destinationAdapterResolver(
  options: DestinationAdapterOptions,
): DestinationAdapterResolver {
  return (destination) => {
    if (!isDestinationType(destination.type)) throw new UnknownDestinationTypeError(destination);
    return DESTINATION_ADAPTERS[destination.type](destination, options);
  };
}

/**
 * The resolver of an Instance that allows no internal host (`STRICT_OUTBOUND_POLICY`)
 * and has no SMTP server: an email Destination fails until one is passed.
 */
export const resolveDestinationAdapter = destinationAdapterResolver({
  fetch: guardedFetch(STRICT_OUTBOUND_POLICY),
  mailer: smtpMailer({ settings: () => Promise.resolve(null), policy: STRICT_OUTBOUND_POLICY }),
});
