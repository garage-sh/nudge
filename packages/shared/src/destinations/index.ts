import { z } from 'zod';
import {
  GRAVITES,
  TYPES_RETOUR,
  type ClasseEchec,
  type EtatDestination,
  type Gravite,
  type TypeRetour,
} from '../domaine.js';
import type { DefinitionDestination } from './definition.js';
import { definitionWebhook } from './webhook.js';

export { schemaUrlHttp, type DefinitionDestination } from './definition.js';
export * from './webhook.js';

/**
 * Types de Destination de l'Instance. Ajouter un type : sa définition (config,
 * secrets) dans un fichier voisin, enregistrée ici ; son adaptateur dans
 * `@nudge/destinations` ; son formulaire dans le dashboard. Le type est une clé
 * texte en base : aucune migration.
 */
export const DEFINITIONS_DESTINATION = {
  webhook: definitionWebhook,
} as const satisfies Record<string, DefinitionDestination>;

export type TypeDestination = keyof typeof DEFINITIONS_DESTINATION;
export const TYPES_DESTINATION = Object.keys(DEFINITIONS_DESTINATION) as [
  TypeDestination,
  ...TypeDestination[],
];

export const estTypeDestination = (valeur: string): valeur is TypeDestination =>
  Object.hasOwn(DEFINITIONS_DESTINATION, valeur);

export const LIMITES_DESTINATION = { nom: 100, secret: 4000 } as const;

/** Filtre d'une Destination : au moins un Type retenu, Gravité minimale facultative. */
export const schemaFiltre = z.strictObject({
  types: z
    .array(z.enum(TYPES_RETOUR))
    .min(1, { message: 'Retenez au moins un Type' })
    .transform((types) => TYPES_RETOUR.filter((type) => types.includes(type))),
  graviteMinimale: z.enum(GRAVITES).nullable(),
});
export type FiltreSaisi = z.input<typeof schemaFiltre>;

/** Le Filtre d'une Destination créée sans en préciser : tout Retour Trié lui est envoyé. */
export const FILTRE_TOUT: FiltreVu = { types: TYPES_RETOUR, graviteMinimale: null };

const nomDestination = z.string().trim().min(1).max(LIMITES_DESTINATION.nom);

/**
 * Valeurs des secrets saisis. Dans une modification : une clé absente garde le
 * secret enregistré, `null` l'efface.
 */
const valeursSecrets = z.record(z.string(), z.string().max(LIMITES_DESTINATION.secret));

/**
 * Création d'une Destination. `config` et `secrets` sont ensuite validés par l'api
 * selon le schéma du type (`DEFINITIONS_DESTINATION[type]`).
 */
export const schemaNouvelleDestination = z.strictObject({
  type: z.enum(TYPES_DESTINATION),
  nom: nomDestination,
  filtre: schemaFiltre.optional(),
  config: z.record(z.string(), z.unknown()),
  secrets: valeursSecrets.optional(),
});
export type NouvelleDestination = z.input<typeof schemaNouvelleDestination>;

/** Modification : le type ne change pas ; `config`, si présente, est remplacée en entier. */
export const schemaModificationDestination = z.strictObject({
  nom: nomDestination.optional(),
  filtre: schemaFiltre.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.string().max(LIMITES_DESTINATION.secret).nullable()).optional(),
});
export type ModificationDestination = z.input<typeof schemaModificationDestination>;

export interface FiltreVu {
  readonly types: readonly TypeRetour[];
  readonly graviteMinimale: Gravite | null;
}

/** Une Destination telle que le dashboard la lit : jamais la valeur d'un secret. */
export interface DestinationVu {
  readonly id: string;
  readonly projetId: string;
  readonly nom: string;
  /**
   * Un `TypeDestination` en principe ; une chaîne quelconque pour une Destination
   * d'un type que cette Instance ne sert plus (le dashboard la liste sans l'éditer).
   */
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly filtre: FiltreVu;
  readonly etat: EtatDestination;
  /** Noms des secrets enregistrés (chiffrés). */
  readonly secrets: readonly string[];
  readonly createdAt: string;
}

/** Réponse d'une création, ou d'une régénération des secrets générés par l'Instance. */
export interface DestinationAvecSecretsGeneres {
  readonly destination: DestinationVu;
  /** Lisibles cette seule fois (secret de signature du webhook…). */
  readonly secretsGeneres: Readonly<Record<string, string>>;
}

/** Résultat du bouton « tester » : un Retour d'exemple envoyé, sans Envoi enregistré. */
export type ResultatTestDestination =
  | { readonly statut: 'livre'; readonly lienExterne: string | null }
  | { readonly statut: 'echec'; readonly classe: ClasseEchec; readonly message: string };
