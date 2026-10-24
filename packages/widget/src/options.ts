/**
 * Identité de l'Auteur que l'application hôte connaît (utilisateur connecté).
 * Venue du navigateur, l'Instance l'enregistre comme *déclarée*, jamais attestée.
 */
export interface AuteurDeclare {
  readonly id?: string;
  readonly email?: string;
  readonly nom?: string;
}

/** Métadonnées libres de l'hôte (version, environnement…), jointes au contexte du Retour. */
export type Metadonnees = Readonly<Record<string, string | number | boolean | null>>;

/** Ce que l'Intégrateur donne au Widget. */
export interface OptionsWidget {
  /** Clé publique du Projet (`nk_pub_…`). */
  readonly cle: string;
  /** Adresse de l'Instance nudge (`https://nudge.exemple`). */
  readonly api: string;
  readonly auteur?: AuteurDeclare;
  readonly metadonnees?: Metadonnees;
}
