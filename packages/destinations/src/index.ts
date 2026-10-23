import type { DestinationConfiguree, DestinationAdapterResolver } from '@nudge/core';

/**
 * Registre des adaptateurs de Destination de l'Instance, indexé par type
 * (`webhook`, `discord`…). Chaque ticket d'adapter y ajoute son entrée.
 */
export const DESTINATION_ADAPTERS: Readonly<Record<string, DestinationAdapterResolver>> = {};

export class UnknownDestinationTypeError extends Error {
  override readonly name = 'UnknownDestinationTypeError';
  constructor(readonly destination: DestinationConfiguree) {
    super(`Aucun adapter pour le type de Destination « ${destination.type} »`);
  }
}

export const resolveDestinationAdapter: DestinationAdapterResolver = (destination) => {
  const factory = DESTINATION_ADAPTERS[destination.type];
  if (!factory) throw new UnknownDestinationTypeError(destination);
  return factory(destination);
};
