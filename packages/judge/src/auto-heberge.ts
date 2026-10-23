import { jugeDecisions } from './decisions-http.js';
import type { Juge } from './port.js';
import { joindre, type OptionsAdaptateur } from './url.js';

/**
 * Modèle servi par Decider for Mac, le serveur local publié par Perplexity
 * (https://docs.perplexity.ai/docs/decisions/decider-for-mac).
 */
export const MODELE_AUTO_HEBERGE = 'pplx-decider-flash-v1.2';

/**
 * pplx-decider auto-hébergé : tout serveur exposant l'API Decisions de Perplexity,
 * `POST <urlBase>/v1/decisions` (https://docs.perplexity.ai/api-reference/decisions-post).
 * Les poids sont publiés (Apache-2.0) mais sans serveur HTTP pour Linux : c'est au
 * self-hoster d'en servir un. La clé est facultative (Decider for Mac n'en demande pas).
 */
export function jugeAutoHeberge(
  options: OptionsAdaptateur & { readonly urlBase: string; readonly cleApi?: string | null },
): Juge {
  return jugeDecisions({
    fournisseur: 'Serveur Decisions',
    url: joindre(options.urlBase, '/v1/decisions'),
    modele: options.modele ?? MODELE_AUTO_HEBERGE,
    cleApi: options.cleApi ?? null,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
