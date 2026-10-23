import { z } from 'zod';

/**
 * Contrat de l'API du dashboard (`/api/…`) : corps acceptés (schémas zod, validés
 * par l'api) et réponses (types, lus par le dashboard).
 */

export const LIMITES_DASHBOARD = {
  email: 320,
  motDePasseMin: 12,
  /** Borne haute : le hachage argon2id d'un mot de passe démesuré coûterait pour rien. */
  motDePasseMax: 256,
  nomProjet: 100,
  descriptionProjet: 2000,
  origines: 50,
  origine: 2048,
} as const;

const email = z.string().trim().toLowerCase().pipe(z.email().max(LIMITES_DASHBOARD.email));

/** Création d'un compte de Membre (setup, invitation). */
export const schemaNouveauMembre = z.strictObject({
  email,
  motDePasse: z
    .string()
    .min(LIMITES_DASHBOARD.motDePasseMin, {
      message: `${LIMITES_DASHBOARD.motDePasseMin} caractères au moins`,
    })
    .max(LIMITES_DASHBOARD.motDePasseMax),
});
export type NouveauMembre = z.input<typeof schemaNouveauMembre>;

/** Connexion : on ne rappelle pas la politique de mot de passe à qui se trompe. */
export const schemaConnexion = z.strictObject({
  email: z.string().trim().toLowerCase().max(LIMITES_DASHBOARD.email),
  motDePasse: z.string().min(1).max(LIMITES_DASHBOARD.motDePasseMax),
});
export type Connexion = z.input<typeof schemaConnexion>;

/**
 * Une origine autorisée, normalisée (`https://Exemple.com/` → `https://exemple.com`).
 * Un chemin, une requête ou des identifiants trahissent une URL collée par erreur : refusés.
 */
export const schemaOrigine = z
  .string()
  .trim()
  .max(LIMITES_DASHBOARD.origine)
  .transform((valeur, ctx) => {
    let url: URL;
    try {
      url = new URL(valeur);
    } catch {
      ctx.addIssue({ code: 'custom', message: `Origine invalide : ${valeur}` });
      return z.NEVER;
    }
    const nue =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
    if (!nue) {
      ctx.addIssue({
        code: 'custom',
        message: `Une origine s'écrit schéma://hôte[:port], sans chemin : ${valeur}`,
      });
      return z.NEVER;
    }
    return url.origin;
  });

const originesAutorisees = z
  .array(schemaOrigine)
  .max(LIMITES_DASHBOARD.origines)
  .transform((origines) => [...new Set(origines)]);

const nomProjet = z.string().trim().min(1).max(LIMITES_DASHBOARD.nomProjet);

/** Description du Projet : facultative ; une chaîne vide l'efface. */
const descriptionProjet = z
  .string()
  .trim()
  .max(LIMITES_DASHBOARD.descriptionProjet)
  .nullable()
  .transform((valeur) => (valeur ? valeur : null));

export const schemaNouveauProjet = z.strictObject({
  nom: nomProjet,
  description: descriptionProjet.optional(),
  originesAutorisees: originesAutorisees.optional(),
});
export type NouveauProjet = z.input<typeof schemaNouveauProjet>;

export const schemaModificationProjet = z.strictObject({
  nom: nomProjet.optional(),
  description: descriptionProjet.optional(),
  originesAutorisees: originesAutorisees.optional(),
});
export type ModificationProjet = z.input<typeof schemaModificationProjet>;

/** Corps d'erreur de l'api : un code stable, et le détail des champs refusés le cas échéant. */
export interface ApiErrorBody {
  readonly erreur: string;
  readonly details?: readonly { readonly chemin: string; readonly message: string }[];
}

export interface MembreVu {
  readonly id: string;
  readonly email: string;
}

export interface SessionVue {
  readonly membre: MembreVu;
}

export interface EtatSetup {
  /** `true` tant qu'aucun Membre n'existe : le setup est ouvert. */
  readonly requis: boolean;
}

export interface InvitationCreee {
  /** À placer dans le lien d'invitation ; il n'est lisible qu'ici. */
  readonly jeton: string;
  readonly expireLe: string;
}

export interface InvitationVue {
  readonly expireLe: string;
}

export interface ProjetVu {
  readonly id: string;
  readonly nom: string;
  readonly description: string | null;
  readonly clePublique: string;
  readonly originesAutorisees: readonly string[];
  readonly createdAt: string;
}

/** Réponse d'une création de Projet ou d'une régénération de la clé secrète. */
export interface ProjetAvecCleSecrete {
  readonly projet: ProjetVu;
  /** Lisible une seule fois : l'Instance n'en garde que l'empreinte. */
  readonly cleSecrete: string;
}
