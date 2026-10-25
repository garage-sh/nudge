import { describe, expect, it } from 'vitest';
import { storageConfigFromEnv } from './config.js';

describe('Capture storage chosen by the environment', () => {
  it('local disk by default, in /var/lib/nudge/captures', () => {
    expect(storageConfigFromEnv({})).toEqual({
      type: 'disk',
      dir: '/var/lib/nudge/captures',
    });
  });

  it('rejects a relative directory, which the api and the worker would each resolve elsewhere', () => {
    expect(() => storageConfigFromEnv({ NUDGE_CAPTURES_DIR: 'data/captures' })).toThrow(
      /Invalid NUDGE_CAPTURES_DIR/,
    );
  });

  it('local disk in the given directory', () => {
    expect(
      storageConfigFromEnv({
        NUDGE_CAPTURES_STORAGE: 'disk',
        NUDGE_CAPTURES_DIR: '/var/lib/nudge/captures',
      }),
    ).toEqual({ type: 'disk', dir: '/var/lib/nudge/captures' });
  });

  it('S3-compatible: path style and no prefix by default', () => {
    expect(
      storageConfigFromEnv({
        NUDGE_CAPTURES_STORAGE: 's3',
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
      prefix: '',
      forcePathStyle: true,
    });
  });

  it('S3: us-east-1 region by default, prefix and subdomain style on request', () => {
    expect(
      storageConfigFromEnv({
        NUDGE_CAPTURES_STORAGE: 's3',
        NUDGE_S3_ENDPOINT: 'https://s3.amazonaws.com',
        NUDGE_S3_BUCKET: 'nudge',
        NUDGE_S3_ACCESS_KEY_ID: 'AK',
        NUDGE_S3_SECRET_ACCESS_KEY: 'SK',
        NUDGE_S3_PREFIX: 'captures',
        NUDGE_S3_FORCE_PATH_STYLE: 'false',
      }),
    ).toMatchObject({ region: 'us-east-1', prefix: 'captures', forcePathStyle: false });
  });

  it.each([
    'NUDGE_S3_ENDPOINT',
    'NUDGE_S3_BUCKET',
    'NUDGE_S3_ACCESS_KEY_ID',
    'NUDGE_S3_SECRET_ACCESS_KEY',
  ])('S3 without %s: throws at startup', (variable) => {
    const env: Record<string, string> = {
      NUDGE_CAPTURES_STORAGE: 's3',
      NUDGE_S3_ENDPOINT: 'http://minio:9000',
      NUDGE_S3_BUCKET: 'nudge',
      NUDGE_S3_ACCESS_KEY_ID: 'AK',
      NUDGE_S3_SECRET_ACCESS_KEY: 'SK',
    };
    delete env[variable];

    expect(() => storageConfigFromEnv(env)).toThrow(variable);
  });

  it('throws on an unknown storage type', () => {
    expect(() => storageConfigFromEnv({ NUDGE_CAPTURES_STORAGE: 'ftp' })).toThrow(
      /Invalid NUDGE_CAPTURES_STORAGE/,
    );
  });

  it('throws on an S3 endpoint that is not an http(s) URL', () => {
    expect(() =>
      storageConfigFromEnv({
        NUDGE_CAPTURES_STORAGE: 's3',
        NUDGE_S3_ENDPOINT: 'minio:9000',
        NUDGE_S3_BUCKET: 'nudge',
        NUDGE_S3_ACCESS_KEY_ID: 'AK',
        NUDGE_S3_SECRET_ACCESS_KEY: 'SK',
      }),
    ).toThrow(/NUDGE_S3_ENDPOINT/);
  });
});
