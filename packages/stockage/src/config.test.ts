import { describe, expect, it } from 'vitest';
import { configStockageDepuisEnv } from './config.js';

describe('Stockage des Captures choisi par l’environnement', () => {
  it('disque local par défaut, dans /var/lib/nudge/captures', () => {
    expect(configStockageDepuisEnv({})).toEqual({
      type: 'disque',
      dossier: '/var/lib/nudge/captures',
    });
  });

  it('refuse un dossier relatif, que l’api et le worker liraient chacun ailleurs', () => {
    expect(() => configStockageDepuisEnv({ NUDGE_CAPTURES_DOSSIER: 'data/captures' })).toThrow(
      /NUDGE_CAPTURES_DOSSIER invalide/,
    );
  });

  it('disque local dans le dossier donné', () => {
    expect(
      configStockageDepuisEnv({
        NUDGE_CAPTURES_STOCKAGE: 'disque',
        NUDGE_CAPTURES_DOSSIER: '/var/lib/nudge/captures',
      }),
    ).toEqual({ type: 'disque', dossier: '/var/lib/nudge/captures' });
  });

  it('S3-compatible : style chemin et sans préfixe par défaut', () => {
    expect(
      configStockageDepuisEnv({
        NUDGE_CAPTURES_STOCKAGE: 's3',
        NUDGE_S3_ENDPOINT: 'http://minio:9000',
        NUDGE_S3_REGION: 'garage',
        NUDGE_S3_BUCKET: 'nudge',
        NUDGE_S3_ACCESS_KEY_ID: 'AK',
        NUDGE_S3_SECRET_ACCESS_KEY: 'SK',
      }),
    ).toEqual({
      type: 's3',
      endpoint: 'http://minio:9000',
      region: 'garage',
      bucket: 'nudge',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      prefixe: '',
      styleChemin: true,
    });
  });

  it('S3 : région us-east-1 par défaut, préfixe et style sous-domaine sur demande', () => {
    expect(
      configStockageDepuisEnv({
        NUDGE_CAPTURES_STOCKAGE: 's3',
        NUDGE_S3_ENDPOINT: 'https://s3.amazonaws.com',
        NUDGE_S3_BUCKET: 'nudge',
        NUDGE_S3_ACCESS_KEY_ID: 'AK',
        NUDGE_S3_SECRET_ACCESS_KEY: 'SK',
        NUDGE_S3_PREFIXE: 'captures',
        NUDGE_S3_STYLE_CHEMIN: 'false',
      }),
    ).toMatchObject({ region: 'us-east-1', prefixe: 'captures', styleChemin: false });
  });

  it.each([
    'NUDGE_S3_ENDPOINT',
    'NUDGE_S3_BUCKET',
    'NUDGE_S3_ACCESS_KEY_ID',
    'NUDGE_S3_SECRET_ACCESS_KEY',
  ])('S3 sans %s : lève au démarrage', (variable) => {
    const env: Record<string, string> = {
      NUDGE_CAPTURES_STOCKAGE: 's3',
      NUDGE_S3_ENDPOINT: 'http://minio:9000',
      NUDGE_S3_BUCKET: 'nudge',
      NUDGE_S3_ACCESS_KEY_ID: 'AK',
      NUDGE_S3_SECRET_ACCESS_KEY: 'SK',
    };
    delete env[variable];

    expect(() => configStockageDepuisEnv(env)).toThrow(variable);
  });

  it('lève sur un type de stockage inconnu', () => {
    expect(() => configStockageDepuisEnv({ NUDGE_CAPTURES_STOCKAGE: 'ftp' })).toThrow(
      /NUDGE_CAPTURES_STOCKAGE invalide/,
    );
  });

  it('lève sur un point d’appel S3 qui n’est pas une URL http(s)', () => {
    expect(() =>
      configStockageDepuisEnv({
        NUDGE_CAPTURES_STOCKAGE: 's3',
        NUDGE_S3_ENDPOINT: 'minio:9000',
        NUDGE_S3_BUCKET: 'nudge',
        NUDGE_S3_ACCESS_KEY_ID: 'AK',
        NUDGE_S3_SECRET_ACCESS_KEY: 'SK',
      }),
    ).toThrow(/NUDGE_S3_ENDPOINT/);
  });
});
