import { DEFAULT_JUDGE_MODELS } from '@nudge/shared';
import { decisionsJudge } from './decisions-http.js';
import type { Judge } from './port.js';
import { joinUrl, type AdapterOptions } from './url.js';

/** TypeSafe API host (https://docs.typesafe.ai/api/system-one). */
export const TYPESAFE_URL = 'https://api.typesafe.ai';

/** Jev, through TypeSafe's systemone API: `POST /v1/systemone`. */
export function typeSafeJudge(options: AdapterOptions & { readonly apiKey: string }): Judge {
  return decisionsJudge({
    provider: 'TypeSafe',
    url: joinUrl(options.baseUrl ?? TYPESAFE_URL, '/v1/systemone'),
    model: options.model ?? DEFAULT_JUDGE_MODELS.typesafe,
    apiKey: options.apiKey,
    fetch: options.fetch,
  });
}
