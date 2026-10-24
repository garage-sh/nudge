import { z } from 'zod';
import { TYPES_RETOUR, type EtatRetour } from './domaine.js';

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

/** Formats d'image d'une Capture : ceux que le Widget produit depuis un canvas. */
export const TYPES_CAPTURE = ['image/png', 'image/jpeg'] as const;
export type TypeCapture = (typeof TYPES_CAPTURE)[number];

/** Taille maximale d'une Capture décodée : 2 Mio. */
export const OCTETS_CAPTURE_MAX = 2_097_152;

/** Signature (premiers octets) de chaque format : le contenu doit être ce qu'il annonce. */
const SIGNATURES_CAPTURE: Record<TypeCapture, readonly number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

/** Longueur maximale d'une Capture encodée en base64 (4 caractères pour 3 octets). */
export const LONGUEUR_BASE64_CAPTURE_MAX = Math.ceil(OCTETS_CAPTURE_MAX / 3) * 4;

const EXTENSIONS_CAPTURE: Record<TypeCapture, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

/** Nom de fichier d'une Capture, tel qu'un Membre ou une Destination le voit. */
export const nomFichierCapture = (retourId: string, contentType: TypeCapture): string =>
  `capture-${retourId}.${EXTENSIONS_CAPTURE[contentType]}`;

/** Taille en octets d'un contenu encodé en base64 (avec remplissage). */
const octetsBase64 = (data: string): number =>
  (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

const premiersOctets = (data: string): number[] =>
  Array.from(atob(data.slice(0, 12)), (caractere) => caractere.charCodeAt(0));

/**
 * Capture de la page jointe par l'Auteur, déjà masquée et floutée dans son navigateur :
 * une image PNG ou JPEG encodée en base64, d'au plus `OCTETS_CAPTURE_MAX` octets.
 */
export const schemaCaptureEntrante = z
  .strictObject({
    contentType: z.enum(TYPES_CAPTURE),
    data: z
      .base64()
      .max(LONGUEUR_BASE64_CAPTURE_MAX)
      .refine((data) => data.length > 0, { message: 'Capture vide' }),
  })
  .superRefine(({ contentType, data }, contexte) => {
    if (octetsBase64(data) > OCTETS_CAPTURE_MAX) {
      contexte.addIssue({
        code: 'custom',
        path: ['data'],
        message: `Capture de plus de ${OCTETS_CAPTURE_MAX} octets`,
      });
      return;
    }
    const octets = premiersOctets(data);
    if (!SIGNATURES_CAPTURE[contentType].every((octet, index) => octets[index] === octet)) {
      contexte.addIssue({
        code: 'custom',
        path: ['data'],
        message: `Le contenu n'est pas une image ${contentType}`,
      });
    }
  });

/** Corps d'un Retour posté sur l'API publique (Widget ou clé secrète). */
export const schemaRetourEntrant = z.strictObject({
  texte: boundedString(LIMITES_RETOUR.texte).refine(nonBlank, { message: 'Texte vide' }),
  type: z.enum(TYPES_RETOUR).optional(),
  auteur: schemaAuteur.optional(),
  contexte: schemaContexte.optional(),
  capture: schemaCaptureEntrante.optional(),
});

/** Ce que l'appelant envoie. */
export type RetourEntrant = z.input<typeof schemaRetourEntrant>;
/** Ce que l'Instance retient après validation et nettoyage. */
export type RetourValide = z.output<typeof schemaRetourEntrant>;
export type Auteur = z.output<typeof schemaAuteur>;
export type Contexte = z.output<typeof schemaContexte>;
export type CaptureEntrante = z.output<typeof schemaCaptureEntrante>;

/** Réponse de l'API publique (202) : le Retour est conservé et attend son Triage. */
export interface RetourRecu {
  readonly id: string;
  readonly etat: Extract<EtatRetour, 'recu'>;
}
