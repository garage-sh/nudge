import type {
  LIMITES_RETOUR,
  OCTETS_CAPTURE_MAX as OCTETS_CAPTURE_INSTANCE,
  TYPES_CAPTURE as TYPES_CAPTURE_INSTANCE,
  TypeRetour,
} from '@nudge/shared';

/**
 * Valeurs du domaine dont le Widget a besoin, recopiées plutôt qu'importées : le build
 * reste sans dépendance (pas de zod dans la page de l'hôte). Le compilateur les tient
 * alignées sur `@nudge/shared` : un Type ajouté ou une borne changée là-bas casse le
 * typecheck ici.
 */
export const LIBELLES_TYPE = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  avis: 'Avis',
  question: 'Question',
} as const satisfies Record<TypeRetour, string>;

export const TYPES_RETOUR = Object.keys(LIBELLES_TYPE) as TypeRetour[];

/** Bornes de l'ingestion que le Widget applique avant d'envoyer. */
export const LIMITES = {
  texte: 5000,
  email: 320,
  url: 2048,
  userAgent: 1024,
} as const satisfies Pick<typeof LIMITES_RETOUR, 'texte' | 'email' | 'url' | 'userAgent'>;

/** Formats d'une Capture que l'Instance accepte, et sa taille maximale (octets). */
export const TYPES_CAPTURE = [
  'image/png',
  'image/jpeg',
] as const satisfies readonly (typeof TYPES_CAPTURE_INSTANCE)[number][];
export type TypeCapture = (typeof TYPES_CAPTURE)[number];
export const OCTETS_CAPTURE_MAX = 2_097_152 satisfies typeof OCTETS_CAPTURE_INSTANCE;
