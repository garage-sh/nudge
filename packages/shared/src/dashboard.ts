import { z } from 'zod';
import {
  ETATS_RETOUR,
  GRAVITES,
  SOURCES,
  TYPES_RETOUR,
  type ConfianceAuteur,
  type EtatDestination,
  type EtatRetour,
  type Gravite,
  type Source,
  type StatutEnvoi,
  type TypeRetour,
} from './domaine.js';
import type { Contexte } from './retour-entrant.js';

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
  retoursParPage: 50,
  retoursParPageMax: 100,
  /** Caractères du texte d'un Retour repris dans la boîte de réception. */
  apercuRetour: 280,
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

/**
 * Filtres et pagination de la boîte de réception (`GET /api/retours?…`).
 * Type, Gravité et Incertain portent sur le Verdict : un Retour pas encore trié n'y répond pas.
 */
export const schemaFiltresRetours = z.strictObject({
  projet: z.uuid().optional(),
  type: z.enum(TYPES_RETOUR).optional(),
  gravite: z.enum(GRAVITES).optional(),
  etat: z.enum(ETATS_RETOUR).optional(),
  source: z.enum(SOURCES).optional(),
  /** `true` : seulement les Verdicts Incertains, à vérifier en priorité. */
  incertain: z
    .enum(['true', 'false'])
    .transform((valeur) => valeur === 'true')
    .optional(),
  /** Le `suivant` de la page précédente. */
  curseur: z.string().max(200).optional(),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITES_DASHBOARD.retoursParPageMax)
    .default(LIMITES_DASHBOARD.retoursParPage),
});
export interface ProjetRefVu {
  readonly id: string;
  readonly nom: string;
}

export interface VerdictVu {
  readonly typeRetenu: TypeRetour;
  /** `null` en mode dégradé, sans Juge. */
  readonly gravite: Gravite | null;
  readonly indesirable: boolean;
  readonly manipulation: boolean;
  readonly incertain: boolean;
}

/** Une ligne de la boîte de réception. */
export interface RetourResumeVu {
  readonly id: string;
  readonly projet: ProjetRefVu;
  readonly etat: EtatRetour;
  readonly source: Source;
  /** Début du texte, brut : à afficher comme du texte, jamais comme du HTML. */
  readonly apercu: string;
  readonly typeDeclare: TypeRetour | null;
  /** `null` tant que le Retour n'est pas trié. */
  readonly verdict: VerdictVu | null;
  readonly createdAt: string;
}

/** Une page de la boîte de réception, du plus récent au plus ancien. */
export interface PageRetours {
  readonly retours: readonly RetourResumeVu[];
  /** Curseur de la page suivante, `null` sur la dernière. */
  readonly suivant: string | null;
}

export interface AuteurVu {
  readonly id: string | null;
  readonly email: string | null;
  readonly nom: string | null;
  /** Déclarée par le navigateur, ou attestée par la clé secrète. */
  readonly confiance: ConfianceAuteur;
}

export interface DestinationRefVu {
  readonly id: string;
  readonly nom: string;
  /** Clé de l'adapter : `webhook`, `discord`, `linear`… */
  readonly type: string;
  readonly etat: EtatDestination;
}

export interface EnvoiVu {
  readonly id: string;
  readonly destination: DestinationRefVu;
  readonly statut: StatutEnvoi;
  /** Lien vers l'objet créé chez la Destination (issue, message), une fois livré. */
  readonly lienExterne: string | null;
  readonly tentatives: number;
  readonly derniereErreur: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Le détail d'un Retour (`GET /api/retours/:id`). */
export interface RetourDetailVu {
  readonly id: string;
  readonly projet: ProjetRefVu;
  readonly etat: EtatRetour;
  readonly source: Source;
  /** Texte brut de l'Auteur : à afficher comme du texte, jamais comme du HTML. */
  readonly texte: string;
  readonly typeDeclare: TypeRetour | null;
  /** `null` : Auteur anonyme. */
  readonly auteur: AuteurVu | null;
  readonly contexte: Contexte;
  readonly verdict: VerdictVu | null;
  readonly envois: readonly EnvoiVu[];
  readonly createdAt: string;
}
