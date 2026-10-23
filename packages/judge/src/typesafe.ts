import { jugeDecisions } from './decisions-http.js';
import type { Juge } from './port.js';
import { joindre, type OptionsAdaptateur } from './url.js';

/** Hôte de l'API TypeSafe (https://docs.typesafe.ai/api/system-one). */
export const URL_TYPESAFE = 'https://api.typesafe.ai';
/** Alias du dernier Jev publié (https://docs.typesafe.ai/models). */
export const MODELE_TYPESAFE = 'jev-latest';

/** Jev, par l'API systemone de TypeSafe : `POST /v1/systemone`. */
export function jugeTypeSafe(options: OptionsAdaptateur & { readonly cleApi: string }): Juge {
  return jugeDecisions({
    fournisseur: 'TypeSafe',
    url: joindre(options.urlBase ?? URL_TYPESAFE, '/v1/systemone'),
    modele: options.modele ?? MODELE_TYPESAFE,
    cleApi: options.cleApi,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
