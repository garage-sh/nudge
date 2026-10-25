import {
  requiresApiKey,
  requiresBaseUrl,
  JUDGE_PROVIDERS,
  type JudgeProvider,
} from '@nudge/shared';
import { openRouterJudge } from './openrouter.js';
import type { Judge } from './port.js';
import { selfHostedJudge } from './self-hosted.js';
import { typeSafeJudge } from './typesafe.js';

/** The Judge chosen for the Instance, key decrypted. A `null` field takes the default value. */
export interface JudgeConfig {
  readonly provider: JudgeProvider;
  /** Required for TypeSafe and OpenRouter; optional for a self-hosted server. */
  readonly apiKey: string | null;
  readonly model: string | null;
  /** Required for a self-hosted server; replaces the provider's host otherwise (proxy). */
  readonly baseUrl: string | null;
}

/** The chosen provider's adapter. Throws if the configuration is incomplete. */
export function createJudge(
  config: JudgeConfig,
  dependencies: { readonly fetch?: typeof globalThis.fetch } = {},
): Judge {
  const common = { model: config.model, ...dependencies };
  switch (config.provider) {
    case 'typesafe':
    case 'openrouter': {
      if (!config.apiKey) throw new Error(`Judge ${config.provider}: missing API key`);
      const options = { ...common, apiKey: config.apiKey, baseUrl: config.baseUrl };
      return config.provider === 'typesafe' ? typeSafeJudge(options) : openRouterJudge(options);
    }
    case 'self_hosted':
      if (!config.baseUrl) throw new Error('Self-hosted Judge: missing server URL');
      return selfHostedJudge({ ...common, baseUrl: config.baseUrl, apiKey: config.apiKey });
  }
}

const isProvider = (value: string): value is JudgeProvider =>
  (JUDGE_PROVIDERS as readonly string[]).includes(value);

/**
 * Fallback when the Instance has not chosen a Judge in the database: `NUDGE_JUDGE_PROVIDER`
 * (typesafe | openrouter | self_hosted), `NUDGE_JUDGE_API_KEY`, `NUDGE_JUDGE_MODEL`,
 * `NUDGE_JUDGE_BASE_URL`. Without a provider: `null` (degraded mode). An invalid
 * configuration throws, to fail at startup rather than on the first Triage.
 */
export function judgeConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): JudgeConfig | null {
  const provider = env.NUDGE_JUDGE_PROVIDER?.trim();
  if (!provider) return null;
  if (!isProvider(provider)) {
    throw new Error(
      `Invalid NUDGE_JUDGE_PROVIDER: "${provider}" (expected: ${JUDGE_PROVIDERS.join(', ')})`,
    );
  }
  const config: JudgeConfig = {
    provider,
    apiKey: env.NUDGE_JUDGE_API_KEY || null,
    model: env.NUDGE_JUDGE_MODEL || null,
    baseUrl: env.NUDGE_JUDGE_BASE_URL || null,
  };
  if (requiresApiKey(provider) && !config.apiKey) {
    throw new Error(`NUDGE_JUDGE_API_KEY is required for the ${provider} Judge`);
  }
  if (requiresBaseUrl(provider) && !config.baseUrl) {
    throw new Error(`NUDGE_JUDGE_BASE_URL is required for the ${provider} Judge`);
  }
  return config;
}
