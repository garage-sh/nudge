import type { DestinationConfiguree, DestinationAdapterResolver } from '@nudge/core';
import type { TypeDestination } from '@nudge/shared';
import { adaptateurWebhook } from './webhook.js';

export { adaptateurWebhook, type OptionsWebhook } from './webhook.js';
export { classerStatut } from './http.js';

/**
 * Registre des adaptateurs de Destination de l'Instance, un par type déclaré dans
 * `DEFINITIONS_DESTINATION` (@nudge/shared) : le compilateur exige une entrée par type.
 */
export const DESTINATION_ADAPTERS: Readonly<Record<TypeDestination, DestinationAdapterResolver>> = {
  webhook: (destination) => adaptateurWebhook(destination),
};

export class UnknownDestinationTypeError extends Error {
  override readonly name = 'UnknownDestinationTypeError';
  constructor(readonly destination: DestinationConfiguree) {
    super(`Aucun adapter pour le type de Destination « ${destination.type} »`);
  }
}

export const resolveDestinationAdapter: DestinationAdapterResolver = (destination) => {
  const factory = Object.hasOwn(DESTINATION_ADAPTERS, destination.type)
    ? DESTINATION_ADAPTERS[destination.type as TypeDestination]
    : undefined;
  if (!factory) throw new UnknownDestinationTypeError(destination);
  return factory(destination);
};
