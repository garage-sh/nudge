import { isAbsolute } from 'node:path';
import { diskStorage } from './disk.js';
import type { CaptureStorage } from './port.js';
import { s3Storage, type S3Config, type S3Options } from './s3.js';

/** The Instance's Capture storage. */
export type StorageConfig =
  { readonly type: 'disk'; readonly dir: string } | ({ readonly type: 's3' } & S3Config);

/** The Captures volume in the api and worker containers. */
export const DEFAULT_CAPTURES_DIR = '/var/lib/nudge/captures';

/** The adapter of the chosen storage. */
export function createStorage(config: StorageConfig, options: S3Options = {}): CaptureStorage {
  if (config.type === 'disk') return diskStorage(config.dir);
  const { type: _type, ...s3 } = config;
  return s3Storage(s3, options);
}

type Env = Readonly<Record<string, string | undefined>>;

const required = (env: Env, name: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for S3 Capture storage`);
  return value;
};

/**
 * Capture storage: `NUDGE_CAPTURES_STORAGE` = `disk` (default, in
 * `NUDGE_CAPTURES_DIR`, an absolute path — the api and the worker do not run in the
 * same directory —, `/var/lib/nudge/captures` otherwise) or `s3` (`NUDGE_S3_ENDPOINT`,
 * `NUDGE_S3_BUCKET`, `NUDGE_S3_ACCESS_KEY_ID`, `NUDGE_S3_SECRET_ACCESS_KEY`, and
 * optional `NUDGE_S3_REGION` (us-east-1), `NUDGE_S3_PREFIX`,
 * `NUDGE_S3_FORCE_PATH_STYLE` (`true`)). An invalid configuration throws, to fail at
 * startup rather than on the first Capture. The api and the worker read the same one.
 */
export function storageConfigFromEnv(env: Env): StorageConfig {
  const type = env.NUDGE_CAPTURES_STORAGE?.trim() || 'disk';
  if (type === 'disk') {
    const dir = env.NUDGE_CAPTURES_DIR?.trim() || DEFAULT_CAPTURES_DIR;
    if (!isAbsolute(dir)) {
      throw new Error(`Invalid NUDGE_CAPTURES_DIR: "${dir}" (absolute path expected)`);
    }
    return { type, dir };
  }
  if (type !== 's3') {
    throw new Error(`Invalid NUDGE_CAPTURES_STORAGE: "${type}" (expected: disk, s3)`);
  }
  const endpoint = required(env, 'NUDGE_S3_ENDPOINT');
  if (!/^https?:\/\/[^/]/.test(endpoint) || !URL.canParse(endpoint)) {
    throw new Error(`Invalid NUDGE_S3_ENDPOINT: "${endpoint}" (http(s) URL expected)`);
  }
  return {
    type,
    endpoint,
    region: env.NUDGE_S3_REGION?.trim() || 'us-east-1',
    bucket: required(env, 'NUDGE_S3_BUCKET'),
    accessKeyId: required(env, 'NUDGE_S3_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'NUDGE_S3_SECRET_ACCESS_KEY'),
    prefix: env.NUDGE_S3_PREFIX?.trim() ?? '',
    forcePathStyle: env.NUDGE_S3_FORCE_PATH_STYLE?.trim() !== 'false',
  };
}
