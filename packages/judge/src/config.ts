import { exigeCleApi, exigeUrlBase, FOURNISSEURS_JUGE, type FournisseurJuge } from '@nudge/shared';
import { jugeAutoHeberge } from './auto-heberge.js';
import { jugeOpenRouter } from './openrouter.js';
import type { Juge } from './port.js';
import { jugeTypeSafe } from './typesafe.js';

/** Le Juge choisi pour l'Instance, clé déchiffrée. Un champ `null` prend la valeur par défaut. */
export interface ConfigJuge {
  readonly fournisseur: FournisseurJuge;
  /** Requise pour TypeSafe et OpenRouter ; facultative pour un serveur auto-hébergé. */
  readonly cleApi: string | null;
  readonly modele: string | null;
  /** Requise pour un serveur auto-hébergé ; remplace l'hôte du fournisseur sinon (proxy). */
  readonly urlBase: string | null;
}

/** L'adaptateur du fournisseur choisi. Lève si la configuration est incomplète. */
export function createJuge(
  config: ConfigJuge,
  dependances: { readonly fetch?: typeof globalThis.fetch } = {},
): Juge {
  const commun = { modele: config.modele, ...dependances };
  switch (config.fournisseur) {
    case 'typesafe':
    case 'openrouter': {
      if (!config.cleApi) throw new Error(`Juge ${config.fournisseur} : clé API manquante`);
      const options = { ...commun, cleApi: config.cleApi, urlBase: config.urlBase };
      return config.fournisseur === 'typesafe' ? jugeTypeSafe(options) : jugeOpenRouter(options);
    }
    case 'auto_heberge':
      if (!config.urlBase) throw new Error('Juge auto-hébergé : URL du serveur manquante');
      return jugeAutoHeberge({ ...commun, urlBase: config.urlBase, cleApi: config.cleApi });
  }
}

const estFournisseur = (valeur: string): valeur is FournisseurJuge =>
  (FOURNISSEURS_JUGE as readonly string[]).includes(valeur);

/**
 * Repli quand l'Instance n'a pas choisi de Juge en base : `NUDGE_JUDGE_PROVIDER`
 * (typesafe | openrouter | auto_heberge), `NUDGE_JUDGE_API_KEY`, `NUDGE_JUDGE_MODEL`,
 * `NUDGE_JUDGE_BASE_URL`. Sans fournisseur : `null` (mode dégradé). Une
 * configuration invalide lève, pour échouer au démarrage plutôt qu'au premier Triage.
 */
export function configJugeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ConfigJuge | null {
  const fournisseur = env.NUDGE_JUDGE_PROVIDER?.trim();
  if (!fournisseur) return null;
  if (!estFournisseur(fournisseur)) {
    throw new Error(
      `NUDGE_JUDGE_PROVIDER invalide : « ${fournisseur} » (attendu : ${FOURNISSEURS_JUGE.join(', ')})`,
    );
  }
  const config: ConfigJuge = {
    fournisseur,
    cleApi: env.NUDGE_JUDGE_API_KEY || null,
    modele: env.NUDGE_JUDGE_MODEL || null,
    urlBase: env.NUDGE_JUDGE_BASE_URL || null,
  };
  if (exigeCleApi(fournisseur) && !config.cleApi) {
    throw new Error(`NUDGE_JUDGE_API_KEY requise pour le Juge ${fournisseur}`);
  }
  if (exigeUrlBase(fournisseur) && !config.urlBase) {
    throw new Error(`NUDGE_JUDGE_BASE_URL requise pour le Juge ${fournisseur}`);
  }
  return config;
}
