import { describe, expect, it } from 'vitest';
import { configApiFromEnv } from './env.js';

const MINIMAL = {
  DATABASE_URL: 'postgres://nudge:nudge@postgres:5432/nudge',
  REDIS_URL: 'redis://redis:6379',
  NUDGE_ENCRYPTION_KEY: 'Y2xlZi1kZS10ZXN0LWRlLTMyLW9jdGV0cy1leGFjdHM=', // gitleaks:allow (clé factice)
};

describe('Configuration de l’api par variables d’environnement', () => {
  it('démarre avec la base, Redis et la clé d’Instance, le reste par défaut', () => {
    expect(configApiFromEnv(MINIMAL)).toEqual({
      port: 3000,
      databaseUrl: MINIMAL.DATABASE_URL,
      redisUrl: MINIMAL.REDIS_URL,
      cleChiffrement: MINIMAL.NUDGE_ENCRYPTION_KEY,
      stockage: { type: 'disque', dossier: '/var/lib/nudge/captures' },
      sessionCookieSecure: true,
      trustProxy: false,
      limitesWidget: {
        parIp: { limit: 20, windowMs: 60_000 },
        parProjet: { limit: 600, windowMs: 60_000 },
      },
    });
  });

  it('lit le port, le cookie, les limites du Widget par minute', () => {
    expect(
      configApiFromEnv({
        ...MINIMAL,
        NUDGE_API_PORT: '8081',
        NUDGE_COOKIE_SECURE: 'false',
        NUDGE_WIDGET_LIMITE_IP: '5',
        NUDGE_WIDGET_LIMITE_PROJET: '1000',
      }),
    ).toMatchObject({
      port: 8081,
      sessionCookieSecure: false,
      limitesWidget: {
        parIp: { limit: 5, windowMs: 60_000 },
        parProjet: { limit: 1000, windowMs: 60_000 },
      },
    });
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['true', true],
    ['false', false],
    ['loopback, uniquelocal', 'loopback, uniquelocal'],
    ['10.0.0.0/8', '10.0.0.0/8'],
  ])('lit NUDGE_TRUST_PROXY=%s comme le réglage `trust proxy` d’Express', (valeur, attendu) => {
    expect(configApiFromEnv({ ...MINIMAL, NUDGE_TRUST_PROXY: valeur }).trustProxy).toEqual(attendu);
  });

  it.each([
    ['NUDGE_COOKIE_SECURE', 'non'],
    ['NUDGE_API_PORT', '70000'],
    ['NUDGE_WIDGET_LIMITE_IP', '0'],
    ['NUDGE_WIDGET_LIMITE_PROJET', 'illimité'],
    ['NUDGE_CAPTURES_DOSSIER', 'captures'],
  ])('refuse de démarrer avec %s=%s', (variable, valeur) => {
    expect(() => configApiFromEnv({ ...MINIMAL, [variable]: valeur })).toThrow(variable);
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'NUDGE_ENCRYPTION_KEY'])(
    'refuse de démarrer sans %s',
    (variable) => {
      expect(() => configApiFromEnv({ ...MINIMAL, [variable]: '' })).toThrow(variable);
    },
  );
});
