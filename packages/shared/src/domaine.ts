/** Valeurs du domaine partagées par l'API, le worker, le dashboard et le SDK (vocabulaire de CONTEXT.md). */

export const TYPES_RETOUR = ['bug', 'suggestion', 'avis', 'question'] as const;
export type TypeRetour = (typeof TYPES_RETOUR)[number];

/** Niveaux ordonnés, du moins au plus grave. */
export const GRAVITES = ['cosmetique', 'mineure', 'majeure', 'bloquante'] as const;
export type Gravite = (typeof GRAVITES)[number];

/** `extension` est réservée au futur module de QA. */
export const SOURCES = ['widget', 'api', 'extension'] as const;
export type Source = (typeof SOURCES)[number];

export const ETATS_RETOUR = ['recu', 'trie', 'dispatche', 'ecarte', 'en_revue'] as const;
export type EtatRetour = (typeof ETATS_RETOUR)[number];

/** Identité de l'Auteur : déclarée par le navigateur, ou attestée par la clé secrète. */
export const CONFIANCES_AUTEUR = ['declaree', 'attestee'] as const;
export type ConfianceAuteur = (typeof CONFIANCES_AUTEUR)[number];

export const ETATS_DESTINATION = ['active', 'suspendue'] as const;
export type EtatDestination = (typeof ETATS_DESTINATION)[number];

export const STATUTS_ENVOI = ['en_attente', 'livre', 'echec', 'retenu'] as const;
export type StatutEnvoi = (typeof STATUTS_ENVOI)[number];

/**
 * Fournisseurs de Juge qu'une Instance peut choisir : Jev par l'API TypeSafe,
 * pplx-decider par l'API Decisions d'OpenRouter, ou tout serveur auto-hébergé de
 * l'API Decisions (pplx-decider).
 */
export const FOURNISSEURS_JUGE = ['typesafe', 'openrouter', 'auto_heberge'] as const;
export type FournisseurJuge = (typeof FOURNISSEURS_JUGE)[number];
