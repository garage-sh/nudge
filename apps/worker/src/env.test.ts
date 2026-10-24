import { describe, expect, it } from 'vitest';
import { configWorkerFromEnv } from './env.js';

const MINIMAL = {
  DATABASE_URL: 'postgres://nudge:nudge@postgres:5432/nudge',
  REDIS_URL: 'redis://redis:6379',
  NUDGE_ENCRYPTION_KEY: 'Y2xlZi1kZS10ZXN0LWRlLTMyLW9jdGV0cy1leGFjdHM=',
};

describe('Configuration du worker par variables d’environnement', () => {
  it('démarre avec la base, Redis et la clé d’Instance, le reste par défaut', () => {
    expect(configWorkerFromEnv(MINIMAL)).toEqual({
      databaseUrl: MINIMAL.DATABASE_URL,
      redisUrl: MINIMAL.REDIS_URL,
      cleChiffrement: MINIMAL.NUDGE_ENCRYPTION_KEY,
      jugeParDefaut: null,
      stockage: { type: 'disque', dossier: '/var/lib/nudge/captures' },
      dashboardUrl: null,
      seuilsTriage: { indesirable: 0.8, manipulation: 0.7, confiance: 0.6 },
      delaiJugeMs: 30_000,
      suspension: { seuilEchecs: 5, refroidissementMs: 300_000, intervalleSondeMs: 60_000 },
      purge: { intervalleMs: 3_600_000 },
    });
  });

  it('lit les seuils du Triage, le délai du Juge, la Suspension, la purge et le dashboard', () => {
    const config = configWorkerFromEnv({
      ...MINIMAL,
      NUDGE_TRIAGE_SEUIL_INDESIRABLE: '0.9',
      NUDGE_TRIAGE_SEUIL_MANIPULATION: '0.55',
      NUDGE_TRIAGE_SEUIL_CONFIANCE: '1',
      NUDGE_JUDGE_TIMEOUT_MS: '45000',
      NUDGE_SUSPENSION_SEUIL_ECHECS: '3',
      NUDGE_SUSPENSION_REFROIDISSEMENT_MS: '600000',
      NUDGE_SUSPENSION_INTERVALLE_SONDE_MS: '30000',
      NUDGE_PURGE_INTERVALLE_MS: '900000',
      NUDGE_DASHBOARD_URL: 'https://nudge.exemple.com',
    });

    expect(config).toMatchObject({
      seuilsTriage: { indesirable: 0.9, manipulation: 0.55, confiance: 1 },
      delaiJugeMs: 45_000,
      suspension: { seuilEchecs: 3, refroidissementMs: 600_000, intervalleSondeMs: 30_000 },
      purge: { intervalleMs: 900_000 },
      dashboardUrl: 'https://nudge.exemple.com',
    });
  });

  it('garde le défaut d’un seuil dont la variable est vide', () => {
    const config = configWorkerFromEnv({ ...MINIMAL, NUDGE_TRIAGE_SEUIL_MANIPULATION: '0.5' });
    expect(config.seuilsTriage).toEqual({ indesirable: 0.8, manipulation: 0.5, confiance: 0.6 });
    expect(
      configWorkerFromEnv({ ...MINIMAL, NUDGE_TRIAGE_SEUIL_INDESIRABLE: '' }).seuilsTriage,
    ).toMatchObject({ indesirable: 0.8 });
  });

  it.each([
    ['NUDGE_TRIAGE_SEUIL_INDESIRABLE', '1.2'],
    ['NUDGE_TRIAGE_SEUIL_CONFIANCE', 'beaucoup'],
    ['NUDGE_JUDGE_TIMEOUT_MS', '0'],
    ['NUDGE_JUDGE_TIMEOUT_MS', '30s'],
    ['NUDGE_SUSPENSION_SEUIL_ECHECS', '2.5'],
    ['NUDGE_PURGE_INTERVALLE_MS', '-1'],
    ['NUDGE_DASHBOARD_URL', 'nudge.exemple.com'],
  ])('refuse de démarrer avec %s=%s', (variable, valeur) => {
    expect(() => configWorkerFromEnv({ ...MINIMAL, [variable]: valeur })).toThrow(variable);
  });

  it('lit le Juge de repli et le stockage des Captures', () => {
    const config = configWorkerFromEnv({
      ...MINIMAL,
      NUDGE_JUDGE_PROVIDER: 'typesafe',
      NUDGE_JUDGE_API_KEY: 'ts-factice',
      NUDGE_CAPTURES_DOSSIER: '/srv/captures',
    });
    expect(config.jugeParDefaut).toMatchObject({ fournisseur: 'typesafe', cleApi: 'ts-factice' });
    expect(config.stockage).toEqual({ type: 'disque', dossier: '/srv/captures' });
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'NUDGE_ENCRYPTION_KEY'])(
    'refuse de démarrer sans %s',
    (variable) => {
      expect(() => configWorkerFromEnv({ ...MINIMAL, [variable]: '' })).toThrow(variable);
    },
  );
});
