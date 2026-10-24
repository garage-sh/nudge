import { MODELES_JUGE_PAR_DEFAUT } from '@nudge/shared';
import { jugeDecisions } from './decisions-http.js';
import type { Juge } from './port.js';
import { joinUrl, type OptionsAdaptateur } from './url.js';

/** Hôte de l'API TypeSafe (https://docs.typesafe.ai/api/system-one). */
export const URL_TYPESAFE = 'https://api.typesafe.ai';

/** Jev, par l'API systemone de TypeSafe : `POST /v1/systemone`. */
export function jugeTypeSafe(options: OptionsAdaptateur & { readonly cleApi: string }): Juge {
  return jugeDecisions({
    fournisseur: 'TypeSafe',
    url: joinUrl(options.urlBase ?? URL_TYPESAFE, '/v1/systemone'),
    modele: options.modele ?? MODELES_JUGE_PAR_DEFAUT.typesafe,
    cleApi: options.cleApi,
    fetch: options.fetch,
  });
}
