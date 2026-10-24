import { MODELES_JUGE_PAR_DEFAUT } from '@nudge/shared';
import { jugeDecisions } from './decisions-http.js';
import type { Juge } from './port.js';
import { joindre, type OptionsAdaptateur } from './url.js';

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
    modele: options.modele ?? MODELES_JUGE_PAR_DEFAUT.auto_heberge,
    cleApi: options.cleApi ?? null,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
