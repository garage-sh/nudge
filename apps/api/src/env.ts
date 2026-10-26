import {
  booleanEnv,
  ENCRYPTION_KEY_VARIABLE,
  integerEnv,
  optionalEnv,
  requireEnv,
  type Env,
} from '@nudge/core';
import { outboundPolicyFromEnv, type OutboundPolicy } from '@nudge/destinations';
import { storageConfigFromEnv, type StorageConfig } from '@nudge/storage';
import type { ApiOptions, TrustProxy } from './api.js';
import { DEFAULT_WIDGET_LIMITS } from './ingestion/widget-access.js';

/** What the environment sets for the api; `main.ts` plugs the adapters in. */
export type ApiConfig = Required<
  Pick<
    ApiOptions,
    | 'databaseUrl'
    | 'redisUrl'
    | 'encryptionKey'
    | 'sessionCookieSecure'
    | 'trustProxy'
    | 'widgetLimits'
  >
> & {
  readonly port: number;
  readonly storage: StorageConfig;
  readonly outbound: OutboundPolicy;
};

/**
 * `NUDGE_TRUST_PROXY` as Express understands it: `true`/`false`, a number of proxies to
 * traverse from the right of `X-Forwarded-For`, or trusted addresses and subnets
 * (`loopback, uniquelocal`, `10.0.0.0/8`). Absent: no proxy, the IP seen is the
 * connection's.
 */
function trustProxyFromEnv(env: Env): TrustProxy {
  const value = optionalEnv(env, 'NUDGE_TRUST_PROXY');
  if (value === null || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * The api configuration, read from the environment (see `.env.example`). An invalid
 * value throws, to fail at startup rather than on the first request.
 */
export function apiConfigFromEnv(env: Env): ApiConfig {
  const limits = DEFAULT_WIDGET_LIMITS;
  return {
    port: integerEnv(env, 'NUDGE_API_PORT', 3000, { min: 1, max: 65_535 }),
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    encryptionKey: requireEnv(env, ENCRYPTION_KEY_VARIABLE),
    // The same storage as the worker's: a shared volume, or an S3 bucket.
    storage: storageConfigFromEnv(env),
    // Internal hosts a Member-configured URL may reach (test buttons of the Destinations).
    outbound: outboundPolicyFromEnv(env),
    sessionCookieSecure: booleanEnv(env, 'NUDGE_COOKIE_SECURE', true),
    trustProxy: trustProxyFromEnv(env),
    widgetLimits: {
      perIp: {
        limit: integerEnv(env, 'NUDGE_WIDGET_RATE_LIMIT_IP', limits.perIp.limit, { min: 1 }),
        windowMs: limits.perIp.windowMs,
      },
      perProject: {
        limit: integerEnv(env, 'NUDGE_WIDGET_RATE_LIMIT_PROJECT', limits.perProject.limit, {
          min: 1,
        }),
        windowMs: limits.perProject.windowMs,
      },
    },
  };
}
