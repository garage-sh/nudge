import type { DestinationConfiguree, DestinationAdapterResolver } from '@nudge/core';
import { estTypeDestination, type TypeDestination } from '@nudge/shared';
import { adaptateurWebhook } from './webhook.js';

export { adaptateurWebhook, type OptionsWebhook } from './webhook.js';

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
  if (!estTypeDestination(destination.type)) throw new UnknownDestinationTypeError(destination);
  return DESTINATION_ADAPTERS[destination.type](destination);
};
