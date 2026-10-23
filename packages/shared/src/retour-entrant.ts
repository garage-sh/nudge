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

// Caractères de contrôle C0 et DEL, hors tabulation et retours à la ligne.
// eslint-disable-next-line no-control-regex
const CARACTERES_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const retirerCaracteresControle = (valeur: string): string =>
  valeur.replace(CARACTERES_CONTROLE, '');

/** Chaîne nettoyée de ses caractères de contrôle, puis bornée. */
const chaine = (max: number) =>
  z.string().transform(retirerCaracteresControle).pipe(z.string().trim().max(max));

const valeurMetadonnee = z.union([
  chaine(LIMITES_RETOUR.metadonneeValeur),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const metadonnees = z
  .record(chaine(LIMITES_RETOUR.metadonneeCle).pipe(z.string().min(1)), valeurMetadonnee)
  .refine((valeur) => Object.keys(valeur).length <= LIMITES_RETOUR.metadonneesCles, {
    message: `${LIMITES_RETOUR.metadonneesCles} métadonnées au plus`,
  });

const dimension = z.number().int().min(0).max(LIMITES_RETOUR.dimensionViewport);

export const schemaAuteur = z.strictObject({
  id: chaine(LIMITES_RETOUR.auteurChamp).optional(),
  email: chaine(LIMITES_RETOUR.email).pipe(z.email()).optional(),
  nom: chaine(LIMITES_RETOUR.auteurChamp).optional(),
});

export const schemaContexte = z.strictObject({
  url: chaine(LIMITES_RETOUR.url).pipe(z.url()).optional(),
  userAgent: chaine(LIMITES_RETOUR.userAgent).optional(),
  viewport: z.strictObject({ largeur: dimension, hauteur: dimension }).optional(),
  metadonnees: metadonnees.optional(),
});

/** Corps d'un Retour posté sur l'API publique (Widget ou clé secrète). */
export const schemaRetourEntrant = z.strictObject({
  texte: chaine(LIMITES_RETOUR.texte).pipe(z.string().min(1)),
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
