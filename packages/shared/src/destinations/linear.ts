import { z } from 'zod';
import { GRAVITES, TYPES_RETOUR } from '../domaine.js';
import type { DefinitionDestination } from './definition.js';

/** Longueur maximale d'un nom de label saisi. */
const NOM_LABEL_MAX = 80;

/**
 * Le label Linear posé pour un Type ou une Gravité, par son nom tel qu'il s'affiche
 * dans Linear (sans tenir compte de la casse). Champ laissé vide : aucun label.
 */
const nomLabel = z.string().trim().min(1).max(NOM_LABEL_MAX);

/**
 * Linear : une issue créée dans l'équipe configurée, par l'API GraphQL avec une clé
 * d'API personnelle (secret, chiffrée en base, jamais rendue).
 *
 * L'équipe est désignée par sa clé (« ENG » dans ENG-123) et les labels par leur nom :
 * l'adaptateur les retrouve dans Linear. Un label inconnu, ou une équipe hors de
 * portée de la clé, refuse la Destination entière.
 */
export const definitionLinear = {
  config: z.strictObject({
    equipe: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,20}$/, {
        message: 'Clé d’équipe Linear attendue (les lettres avant le numéro : ENG dans ENG-123)',
      })
      .transform((cle) => cle.toUpperCase()),
    labels: z
      .strictObject({
        types: z.partialRecord(z.enum(TYPES_RETOUR), nomLabel).default({}),
        gravites: z.partialRecord(z.enum(GRAVITES), nomLabel).default({}),
      })
      .default({ types: {}, gravites: {} }),
  }),
  secrets: z.strictObject({
    cleApi: z.string().trim().min(1, { message: 'Clé d’API Linear attendue' }),
  }),
  secretsGeneres: [],
} as const satisfies DefinitionDestination;

export type ConfigLinear = z.output<typeof definitionLinear.config>;
export type SecretsLinear = z.output<typeof definitionLinear.secrets>;
