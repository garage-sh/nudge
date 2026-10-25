import { DEFAULT_JUDGE_MODELS } from '@nudge/shared';
import { decisionsJudge } from './decisions-http.js';
import type { Judge } from './port.js';
import { joinUrl, type AdapterOptions } from './url.js';

/**
 * Host of OpenRouter's Decisions API: `POST /api/alpha/decisions`
 * (https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).
 */
export const OPENROUTER_URL = 'https://openrouter.ai';

/** pplx-decider (or any OpenRouter decision model) through OpenRouter's Decisions API. */
export function openRouterJudge(options: AdapterOptions & { readonly apiKey: string }): Judge {
  return decisionsJudge({
    provider: 'OpenRouter',
    url: joinUrl(options.baseUrl ?? OPENROUTER_URL, '/api/alpha/decisions'),
    model: options.model ?? DEFAULT_JUDGE_MODELS.openrouter,
    apiKey: options.apiKey,
    fetch: options.fetch,
  });
}
