import {
  ENCRYPTION_KEY_VARIABLE,
  httpUrlEnv,
  integerEnv,
  numberEnv,
  requireEnv,
  DEFAULT_TRIAGE_THRESHOLDS,
  type Env,
} from '@nudge/core';
import { judgeConfigFromEnv } from '@nudge/judge';
import { storageConfigFromEnv, type StorageConfig } from '@nudge/storage';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_JUDGE_TIMEOUT_MS,
  DEFAULT_PURGE,
  DEFAULT_SUSPENSION,
  type WorkerOptions,
} from './options.js';

/** What the environment sets for the worker; the api plugs the adapters in (`apps/api/src/main.ts`). */
export type WorkerConfig = Required<
  Pick<
    WorkerOptions,
    | 'databaseUrl'
    | 'redisUrl'
    | 'encryptionKey'
    | 'defaultJudge'
    | 'dashboardUrl'
    | 'triageThresholds'
    | 'judgeTimeoutMs'
    | 'suspension'
    | 'purge'
    | 'concurrency'
  >
> & { readonly storage: StorageConfig };

const probabilityBounds = { min: 0, max: 1 };
const durationBounds = { min: 1 };

/**
 * The worker configuration, read from the environment (see `.env.example`). An
 * invalid value throws, to fail at startup rather than on the first Triage.
 */
export function workerConfigFromEnv(env: Env): WorkerConfig {
  const thresholds = DEFAULT_TRIAGE_THRESHOLDS;
  const suspension = DEFAULT_SUSPENSION;
  return {
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    encryptionKey: requireEnv(env, ENCRYPTION_KEY_VARIABLE),
    // Fallback when the Instance has not chosen a Judge in the dashboard.
    defaultJudge: judgeConfigFromEnv(env),
    // The same storage as the api's: a shared volume, or an S3 bucket.
    storage: storageConfigFromEnv(env),
    dashboardUrl: httpUrlEnv(env, 'NUDGE_DASHBOARD_URL'),
    triageThresholds: {
      junk: numberEnv(env, 'NUDGE_TRIAGE_JUNK_THRESHOLD', thresholds.junk, probabilityBounds),
      manipulation: numberEnv(
        env,
        'NUDGE_TRIAGE_MANIPULATION_THRESHOLD',
        thresholds.manipulation,
        probabilityBounds,
      ),
      confidence: numberEnv(
        env,
        'NUDGE_TRIAGE_CONFIDENCE_THRESHOLD',
        thresholds.confidence,
        probabilityBounds,
      ),
    },
    judgeTimeoutMs: integerEnv(
      env,
      'NUDGE_JUDGE_TIMEOUT_MS',
      DEFAULT_JUDGE_TIMEOUT_MS,
      durationBounds,
    ),
    suspension: {
      failureThreshold: integerEnv(
        env,
        'NUDGE_SUSPENSION_FAILURE_THRESHOLD',
        suspension.failureThreshold,
        { min: 1 },
      ),
      cooldownMs: integerEnv(
        env,
        'NUDGE_SUSPENSION_COOLDOWN_MS',
        suspension.cooldownMs,
        durationBounds,
      ),
      probeIntervalMs: integerEnv(
        env,
        'NUDGE_SUSPENSION_PROBE_INTERVAL_MS',
        suspension.probeIntervalMs,
        durationBounds,
      ),
    },
    purge: {
      intervalMs: integerEnv(
        env,
        'NUDGE_PURGE_INTERVAL_MS',
        DEFAULT_PURGE.intervalMs,
        durationBounds,
      ),
    },
    concurrency: {
      triage: integerEnv(env, 'NUDGE_TRIAGE_CONCURRENCY', DEFAULT_CONCURRENCY.triage, {
        min: 1,
      }),
      dispatch: integerEnv(env, 'NUDGE_DISPATCH_CONCURRENCY', DEFAULT_CONCURRENCY.dispatch, {
        min: 1,
      }),
    },
  };
}
