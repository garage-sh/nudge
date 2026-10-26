import { Logger } from '@nestjs/common';
import {
  booleanEnv,
  ENCRYPTION_KEY_VARIABLE,
  httpUrlEnv,
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
    | 'setupToken'
    | 'trustProxy'
    | 'widgetLimits'
  >
> & {
  readonly port: number;
  readonly storage: StorageConfig;
  readonly outbound: OutboundPolicy;
};

/**
 * `NUDGE_TRUST_PROXY` as Express understands it: `false`, a number of proxies to
 * traverse from the right of `X-Forwarded-For`, or trusted addresses and subnets
 * (`loopback, uniquelocal`, `10.0.0.0/8`). Absent: no proxy, the IP seen is the
 * connection's. `true` is refused: Express would take the leftmost address, which the
 * client writes itself, and every per-IP limit would be the client's to choose.
 */
function trustProxyFromEnv(env: Env): TrustProxy {
  const value = optionalEnv(env, 'NUDGE_TRUST_PROXY');
  if (value === null || value === 'false') return false;
  if (value === 'true') {
    throw new Error(
      'Invalid NUDGE_TRUST_PROXY: "true" (trusts a client-supplied X-Forwarded-For; ' +
        'expected the number of proxies in front of the api, or their addresses)',
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const isLocalhost = (hostname: string): boolean =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');

/**
 * `NUDGE_COOKIE_SECURE`, true by default. `false` lets the session cookie travel over
 * plain HTTP, readable by anyone on the path: refused when the dashboard is served
 * over HTTPS (nothing to gain), warned about unless the dashboard is on localhost.
 */
function sessionCookieSecureFromEnv(env: Env, warn: (message: string) => void): boolean {
  if (booleanEnv(env, 'NUDGE_COOKIE_SECURE', true)) return true;
  const dashboardUrl = httpUrlEnv(env, 'NUDGE_DASHBOARD_URL');
  const dashboard = dashboardUrl === null ? null : new URL(dashboardUrl);
  if (dashboard?.protocol === 'https:') {
    throw new Error(
      'Invalid NUDGE_COOKIE_SECURE: "false" (NUDGE_DASHBOARD_URL is HTTPS: the session ' +
        'cookie must stay Secure)',
    );
  }
  if (!dashboard || !isLocalhost(dashboard.hostname)) {
    warn(
      'NUDGE_COOKIE_SECURE=false: the session cookie travels in clear over HTTP, and ' +
        'anyone on the network path can take over a Member’s session. Use it only to ' +
        'try the Instance, never on an exposed one.',
    );
  }
  return false;
}

/** Shortest `NUDGE_SETUP_TOKEN` accepted: it guards the claim of the Instance. */
const SETUP_TOKEN_MIN_LENGTH = 16;

/** `NUDGE_SETUP_TOKEN`; absent: `null`, the api derives one from the Instance key. */
function setupTokenFromEnv(env: Env): string | null {
  const value = optionalEnv(env, 'NUDGE_SETUP_TOKEN');
  if (value !== null && value.length < SETUP_TOKEN_MIN_LENGTH) {
    throw new Error(
      `Invalid NUDGE_SETUP_TOKEN (expected at least ${SETUP_TOKEN_MIN_LENGTH} characters)`,
    );
  }
  return value;
}

/**
 * The api configuration, read from the environment (see `.env.example`). An invalid
 * value throws, to fail at startup rather than on the first request; a dangerous one
 * is reported through `warn`.
 */
export function apiConfigFromEnv(
  env: Env,
  warn: (message: string) => void = (message) => new Logger('Configuration').warn(message),
): ApiConfig {
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
    sessionCookieSecure: sessionCookieSecureFromEnv(env, warn),
    setupToken: setupTokenFromEnv(env),
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
