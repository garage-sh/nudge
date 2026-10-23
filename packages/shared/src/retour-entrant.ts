import { z } from 'zod';
import { TYPES_RETOUR } from './domaine.js';

/** Bornes de l'ingestion : elles protègent le stockage et le Juge. */
export const LIMITES_RETOUR = {
  texte: 5000,
  auteurChamp: 255,
  email: 320,
  url: 2048,
  userAgent: 1024,
  dimensionViewport: 100_000,
  metadonneesCles: 50,
  metadonneeCle: 100,
  metadonneeValeur: 1000,
} as const;

// Caractères de contrôle C0, DEL et C1, hors tabulation et retours à la ligne.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const stripControlCharacters = (value: string): string =>
  value.replace(CONTROL_CHARACTERS, '');

/** Chaîne nettoyée de ses caractères de contrôle, puis bornée. Rien d'autre n'est modifié. */
const boundedString = (max: number) =>
  z.string().transform(stripControlCharacters).pipe(z.string().max(max));

const nonBlank = (value: string) => value.trim().length > 0;

const valeurMetadonnee = z.union([
  boundedString(LIMITES_RETOUR.metadonneeValeur),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const metadonnees = z
  .record(boundedString(LIMITES_RETOUR.metadonneeCle).refine(nonBlank), valeurMetadonnee)
  .refine((value) => Object.keys(value).length <= LIMITES_RETOUR.metadonneesCles, {
    message: `${LIMITES_RETOUR.metadonneesCles} métadonnées au plus`,
  });

const dimension = z.number().int().min(0).max(LIMITES_RETOUR.dimensionViewport);

export const schemaAuteur = z.strictObject({
  id: boundedString(LIMITES_RETOUR.auteurChamp).optional(),
  email: boundedString(LIMITES_RETOUR.email).pipe(z.email()).optional(),
  nom: boundedString(LIMITES_RETOUR.auteurChamp).optional(),
});

export const schemaContexte = z.strictObject({
  url: boundedString(LIMITES_RETOUR.url).pipe(z.url()).optional(),
  userAgent: boundedString(LIMITES_RETOUR.userAgent).optional(),
  viewport: z.strictObject({ largeur: dimension, hauteur: dimension }).optional(),
  metadonnees: metadonnees.optional(),
});

/** Corps d'un Retour posté sur l'API publique (Widget ou clé secrète). */
export const schemaRetourEntrant = z.strictObject({
  texte: boundedString(LIMITES_RETOUR.texte).refine(nonBlank, { message: 'Texte vide' }),
  type: z.enum(TYPES_RETOUR).optional(),
  auteur: schemaAuteur.optional(),
  contexte: schemaContexte.optional(),
});

/** Ce que l'appelant envoie. */
export type RetourEntrant = z.input<typeof schemaRetourEntrant>;
/** Ce que l'Instance retient après validation et nettoyage. */
export type RetourValide = z.output<typeof schemaRetourEntrant>;
export type Auteur = z.output<typeof schemaAuteur>;
export type Contexte = z.output<typeof schemaContexte>;
