/** Valeurs du domaine partagées par l'API, le worker, le dashboard et le SDK (vocabulaire de CONTEXT.md). */

export const TYPES_RETOUR = ['bug', 'suggestion', 'avis', 'question'] as const;
export type TypeRetour = (typeof TYPES_RETOUR)[number];

/** Niveaux ordonnés, du moins au plus grave. */
export const GRAVITES = ['cosmetique', 'mineure', 'majeure', 'bloquante'] as const;
export type Gravite = (typeof GRAVITES)[number];

/** Libellés affichés d'un Type et d'une Gravité : dashboard et messages des Destinations. */
export const LIBELLES_TYPE: Readonly<Record<TypeRetour, string>> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  avis: 'Avis',
  question: 'Question',
};

export const LIBELLES_GRAVITE: Readonly<Record<Gravite, string>> = {
  cosmetique: 'Cosmétique',
  mineure: 'Mineure',
  majeure: 'Majeure',
  bloquante: 'Bloquante',
};

/** `extension` est réservée au futur module de QA. */
export const SOURCES = ['widget', 'api', 'extension'] as const;
export type Source = (typeof SOURCES)[number];

export const ETATS_RETOUR = ['recu', 'trie', 'dispatche', 'ecarte', 'en_revue'] as const;
export type EtatRetour = (typeof ETATS_RETOUR)[number];

/**
 * Préfixes des clés d'un Projet : l'ingestion choisit sa voie d'après lui. La clé
 * publique (Widget) déclare l'identité de l'Auteur, la clé secrète (serveur) l'atteste.
 */
export const PREFIXE_CLE_PUBLIQUE = 'nk_pub_';
export const PREFIXE_CLE_SECRETE = 'nk_sec_';

/** Identité de l'Auteur : déclarée par le navigateur, ou attestée par la clé secrète. */
export const CONFIANCES_AUTEUR = ['declaree', 'attestee'] as const;
export type ConfianceAuteur = (typeof CONFIANCES_AUTEUR)[number];

export const ETATS_DESTINATION = ['active', 'suspendue'] as const;
export type EtatDestination = (typeof ETATS_DESTINATION)[number];

export const STATUTS_ENVOI = ['en_attente', 'livre', 'echec', 'retenu'] as const;
export type StatutEnvoi = (typeof STATUTS_ENVOI)[number];

/**
 * Statuts d'où un Membre peut rejouer un Envoi : terminé, livré ou en échec. Un Envoi
 * en attente a déjà un job en cours ; un Envoi retenu attend que sa Destination soit
 * de nouveau active, et la sonde le libère.
 */
export const STATUTS_ENVOI_REJOUABLES = [
  'livre',
  'echec',
] as const satisfies readonly StatutEnvoi[];

export const estEnvoiRejouable = (statut: StatutEnvoi): boolean =>
  (STATUTS_ENVOI_REJOUABLES as readonly StatutEnvoi[]).includes(statut);

/**
 * États d'où un Membre peut redispatcher un Retour (D22) : déjà passé par le Dispatch.
 * Reçu attend son Triage ; Écarté et En revue se revoient d'abord.
 */
export const ETATS_RETOUR_REDISPATCHABLES = [
  'trie',
  'dispatche',
] as const satisfies readonly EtatRetour[];

export const estRetourRedispatchable = (etat: EtatRetour): boolean =>
  (ETATS_RETOUR_REDISPATCHABLES as readonly EtatRetour[]).includes(etat);

/** Les transitions qu'un Membre déclenche sur un Retour retenu par le Triage. */
export const ACTIONS_REVUE = ['valider', 'rejeter', 'rehabiliter'] as const;
export type ActionRevue = (typeof ACTIONS_REVUE)[number];

/**
 * Classe d'un échec d'Envoi (littéraux de la spec) :
 * - `transient` : 5xx, 429, timeout — retenté, compte pour la Suspension ;
 * - `auth` : identifiants refusés — Suspension immédiate, sans retry ;
 * - `permanent` : refusé pour ce Retour précis — échec sans retry ni Suspension.
 */
export const CLASSES_ECHEC = ['transient', 'auth', 'permanent'] as const;
export type ClasseEchec = (typeof CLASSES_ECHEC)[number];

/**
 * Fournisseurs de Juge qu'une Instance peut choisir : Jev par l'API TypeSafe,
 * pplx-decider par l'API Decisions d'OpenRouter, ou tout serveur auto-hébergé de
 * l'API Decisions (pplx-decider).
 */
export const FOURNISSEURS_JUGE = ['typesafe', 'openrouter', 'auto_heberge'] as const;
export type FournisseurJuge = (typeof FOURNISSEURS_JUGE)[number];

/**
 * Modèle demandé quand l'Instance n'en choisit pas : l'alias du dernier Jev chez
 * TypeSafe, pplx-decider figé chez OpenRouter (les seuils du Triage ne bougent pas avec
 * un alias), et le modèle de Decider for Mac, serveur local publié par Perplexity.
 */
export const MODELES_JUGE_PAR_DEFAUT: Readonly<Record<FournisseurJuge, string>> = {
  typesafe: 'jev-latest',
  openrouter: 'perplexity/pplx-decider-v1.2',
  auto_heberge: 'pplx-decider-flash-v1.2',
};

/** TypeSafe et OpenRouter exigent une clé API ; un serveur auto-hébergé peut s'en passer. */
export const exigeCleApi = (fournisseur: FournisseurJuge): boolean =>
  fournisseur !== 'auto_heberge';

/** Un Juge auto-hébergé n'a pas d'adresse par défaut. */
export const exigeUrlBase = (fournisseur: FournisseurJuge): boolean =>
  fournisseur === 'auto_heberge';
