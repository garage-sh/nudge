/** Options communes aux adaptateurs HTTP du Juge. */
export interface OptionsAdaptateur {
  /** Modèle demandé ; celui par défaut de l'adaptateur sinon. */
  readonly modele?: string | null;
  /** Hôte (et préfixe de chemin éventuel) du fournisseur ; celui par défaut sinon. */
  readonly urlBase?: string | null;
  /** Injecté par les tests ; `globalThis.fetch` sinon. */
  readonly fetch?: typeof globalThis.fetch;
}

/** `https://hote/prefixe/` + `/v1/x` → `https://hote/prefixe/v1/x`. */
export const joindre = (base: string, chemin: string): string =>
  `${base.replace(/\/+$/, '')}${chemin}`;
