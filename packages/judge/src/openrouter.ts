import { jugeDecisions } from './decisions-http.js';
import type { Juge } from './port.js';
import { joindre, type OptionsAdaptateur } from './url.js';

/**
 * Hôte de l'API Decisions d'OpenRouter : `POST /api/alpha/decisions`
 * (https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).
 */
export const URL_OPENROUTER = 'https://openrouter.ai';
/** pplx-decider, version figée : les seuils du Triage ne bougent pas avec un alias. */
export const MODELE_OPENROUTER = 'perplexity/pplx-decider-v1.2';

/** pplx-decider (ou tout modèle de décision d'OpenRouter) par l'API Decisions d'OpenRouter. */
export function jugeOpenRouter(options: OptionsAdaptateur & { readonly cleApi: string }): Juge {
  return jugeDecisions({
    fournisseur: 'OpenRouter',
    url: joindre(options.urlBase ?? URL_OPENROUTER, '/api/alpha/decisions'),
    modele: options.modele ?? MODELE_OPENROUTER,
    cleApi: options.cleApi,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
