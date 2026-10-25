import type { ConfiguredDestination, DestinationAdapterResolver } from '@nudge/core';
import { isDestinationType, type DestinationType } from '@nudge/shared';
import { discordAdapter } from './discord.js';
import { gitHubAdapter } from './github.js';
import { linearAdapter } from './linear.js';
import { slackAdapter } from './slack.js';
import { webhookAdapter } from './webhook.js';

export { discordAdapter, type DiscordOptions } from './discord.js';
export { gitHubAdapter, type GitHubOptions } from './github.js';
export { linearAdapter, type LinearOptions } from './linear.js';
export { slackAdapter, type SlackOptions } from './slack.js';
export { webhookAdapter, type WebhookOptions } from './webhook.js';

/**
 * Registry of the Instance's Destination adapters, one per type declared in
 * `DESTINATION_DEFINITIONS` (@nudge/shared): the compiler requires one entry per type.
 */
export const DESTINATION_ADAPTERS: Readonly<Record<DestinationType, DestinationAdapterResolver>> = {
  webhook: (destination) => webhookAdapter(destination),
  discord: (destination) => discordAdapter(destination),
  linear: (destination) => linearAdapter(destination),
  slack: (destination) => slackAdapter(destination),
  github: (destination) => gitHubAdapter(destination),
};

export class UnknownDestinationTypeError extends Error {
  override readonly name = 'UnknownDestinationTypeError';
  constructor(readonly destination: ConfiguredDestination) {
    super(`No adapter for Destination type "${destination.type}"`);
  }
}

export const resolveDestinationAdapter: DestinationAdapterResolver = (destination) => {
  if (!isDestinationType(destination.type)) throw new UnknownDestinationTypeError(destination);
  return DESTINATION_ADAPTERS[destination.type](destination);
};
