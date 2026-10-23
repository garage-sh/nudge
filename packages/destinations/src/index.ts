import type { DestinationConfiguree, ResoudreAdaptateur } from '@nudge/core';

/**
 * Registre des adaptateurs de Destination de l'Instance, indexé par type
 * (`webhook`, `discord`…). Chaque ticket d'adaptateur y ajoute son entrée.
 */
export const ADAPTATEURS: Readonly<Record<string, ResoudreAdaptateur>> = {};

export class TypeDestinationInconnu extends Error {
  override readonly name = 'TypeDestinationInconnu';
  constructor(readonly destination: DestinationConfiguree) {
    super(`Aucun adaptateur pour le type de Destination « ${destination.type} »`);
  }
}

export const resoudreAdaptateur: ResoudreAdaptateur = (destination) => {
  const fabrique = ADAPTATEURS[destination.type];
  if (!fabrique) throw new TypeDestinationInconnu(destination);
  return fabrique(destination);
};
