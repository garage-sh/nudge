import { describe, expect, it } from 'vitest';
import { workerConfigFromEnv } from './env.js';

const MINIMAL = {
  DATABASE_URL: 'postgres://nudge:nudge@postgres:5432/nudge',
  REDIS_URL: 'redis://redis:6379',
  NUDGE_ENCRYPTION_KEY: 'ZHVtbXktdGVzdC1rZXktZXhhY3RseS0zMi1ieXRlcyE=', // gitleaks:allow (dummy key)
};

describe('Worker configuration from environment variables', () => {
  it('starts with the database, Redis and the Instance key, the rest by default', () => {
    expect(workerConfigFromEnv(MINIMAL)).toEqual({
      databaseUrl: MINIMAL.DATABASE_URL,
      redisUrl: MINIMAL.REDIS_URL,
      encryptionKey: MINIMAL.NUDGE_ENCRYPTION_KEY,
      defaultJudge: null,
      storage: { type: 'disk', dir: '/var/lib/nudge/captures' },
      dashboardUrl: null,
      triageThresholds: { junk: 0.8, manipulation: 0.7, confidence: 0.6 },
      judgeTimeoutMs: 30_000,
      suspension: { failureThreshold: 5, cooldownMs: 300_000, probeIntervalMs: 60_000 },
      purge: { intervalMs: 3_600_000 },
    });
  });

  it('reads the Triage thresholds, the Judge timeout, the Suspension, the purge and the dashboard', () => {
    const config = workerConfigFromEnv({
      ...MINIMAL,
      NUDGE_TRIAGE_JUNK_THRESHOLD: '0.9',
      NUDGE_TRIAGE_MANIPULATION_THRESHOLD: '0.55',
      NUDGE_TRIAGE_CONFIDENCE_THRESHOLD: '1',
      NUDGE_JUDGE_TIMEOUT_MS: '45000',
      NUDGE_SUSPENSION_FAILURE_THRESHOLD: '3',
      NUDGE_SUSPENSION_COOLDOWN_MS: '600000',
      NUDGE_SUSPENSION_PROBE_INTERVAL_MS: '30000',
      NUDGE_PURGE_INTERVAL_MS: '900000',
      NUDGE_DASHBOARD_URL: 'https://nudge.example.com',
    });

    expect(config).toMatchObject({
      triageThresholds: { junk: 0.9, manipulation: 0.55, confidence: 1 },
      judgeTimeoutMs: 45_000,
      suspension: { failureThreshold: 3, cooldownMs: 600_000, probeIntervalMs: 30_000 },
      purge: { intervalMs: 900_000 },
      dashboardUrl: 'https://nudge.example.com',
    });
  });

  it('keeps the default of a threshold whose variable is empty', () => {
    const config = workerConfigFromEnv({ ...MINIMAL, NUDGE_TRIAGE_MANIPULATION_THRESHOLD: '0.5' });
    expect(config.triageThresholds).toEqual({ junk: 0.8, manipulation: 0.5, confidence: 0.6 });
    expect(
      workerConfigFromEnv({ ...MINIMAL, NUDGE_TRIAGE_JUNK_THRESHOLD: '' }).triageThresholds,
    ).toMatchObject({ junk: 0.8 });
  });

  it.each([
    ['NUDGE_TRIAGE_JUNK_THRESHOLD', '1.2'],
    ['NUDGE_TRIAGE_CONFIDENCE_THRESHOLD', 'lots'],
    ['NUDGE_JUDGE_TIMEOUT_MS', '0'],
    ['NUDGE_JUDGE_TIMEOUT_MS', '30s'],
    ['NUDGE_SUSPENSION_FAILURE_THRESHOLD', '2.5'],
    ['NUDGE_PURGE_INTERVAL_MS', '-1'],
    ['NUDGE_DASHBOARD_URL', 'nudge.example.com'],
  ])('refuses to start with %s=%s', (variable, value) => {
    expect(() => workerConfigFromEnv({ ...MINIMAL, [variable]: value })).toThrow(variable);
  });

  it('reads the fallback Judge and the Capture storage', () => {
    const config = workerConfigFromEnv({
      ...MINIMAL,
      NUDGE_JUDGE_PROVIDER: 'typesafe',
      NUDGE_JUDGE_API_KEY: 'ts-dummy',
      NUDGE_CAPTURES_DIR: '/srv/captures',
    });
    expect(config.defaultJudge).toMatchObject({ provider: 'typesafe', apiKey: 'ts-dummy' });
    expect(config.storage).toEqual({ type: 'disk', dir: '/srv/captures' });
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'NUDGE_ENCRYPTION_KEY'])(
    'refuses to start without %s',
    (variable) => {
      expect(() => workerConfigFromEnv({ ...MINIMAL, [variable]: '' })).toThrow(variable);
    },
  );
});
