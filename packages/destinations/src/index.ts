import type { ConfiguredDestination, DestinationAdapterResolver } from '@nudge/core';
import { isDestinationType, type DestinationType } from '@nudge/shared';
import { discordAdapter } from './discord.js';
import { gitHubAdapter } from './github.js';
import { linearAdapter } from './linear.js';
import { guardedFetch, STRICT_OUTBOUND_POLICY } from './outbound.js';
import { slackAdapter } from './slack.js';
import { webhookAdapter } from './webhook.js';

export { discordAdapter, type DiscordOptions } from './discord.js';
export { gitHubAdapter, type GitHubOptions } from './github.js';
export { linearAdapter, type LinearOptions } from './linear.js';
export {
  guardedFetch,
  isPublicAddress,
  outboundPolicyFromEnv,
  OutboundRefusedError,
  OUTBOUND_ALLOWED_HOSTS_VARIABLE,
  STRICT_OUTBOUND_POLICY,
  type OutboundPolicy,
} from './outbound.js';
export { slackAdapter, type SlackOptions } from './slack.js';
export { webhookAdapter, type WebhookOptions } from './webhook.js';

/** What every adapter of the registry receives. */
export interface DestinationAdapterOptions {
  /** HTTP client of every call: `guardedFetch` (the URLs come from Members). */
  readonly fetch: typeof globalThis.fetch;
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

/** The resolver of an Instance that allows no internal host (`STRICT_OUTBOUND_POLICY`). */
export const resolveDestinationAdapter = destinationAdapterResolver({
  fetch: guardedFetch(STRICT_OUTBOUND_POLICY),
});
