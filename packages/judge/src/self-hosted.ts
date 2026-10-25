import { DEFAULT_JUDGE_MODELS } from '@nudge/shared';
import { decisionsJudge } from './decisions-http.js';
import type { Judge } from './port.js';
import { joinUrl, type AdapterOptions } from './url.js';

/**
 * Self-hosted pplx-decider: any server exposing Perplexity's Decisions API,
 * `POST <baseUrl>/v1/decisions` (https://docs.perplexity.ai/api-reference/decisions-post).
 * The weights are published (Apache-2.0) but with no HTTP server for Linux: it is up to
 * the self-hoster to serve one. The key is optional (Decider for Mac does not ask for one).
 */
export function selfHostedJudge(
  options: AdapterOptions & { readonly baseUrl: string; readonly apiKey?: string | null },
): Judge {
  return decisionsJudge({
    provider: 'Decisions server',
    url: joinUrl(options.baseUrl, '/v1/decisions'),
    model: options.model ?? DEFAULT_JUDGE_MODELS.self_hosted,
    apiKey: options.apiKey ?? null,
    fetch: options.fetch,
  });
}
