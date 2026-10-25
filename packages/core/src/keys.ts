import { createHash, randomBytes } from 'node:crypto';
import { PUBLIC_KEY_PREFIX, SECRET_KEY_PREFIX } from '@nudge/shared';

/** A Project's keys: the public one for the Widget, the secret one for the server API. */
export interface ProjectKeys {
  readonly publicKey: string;
  readonly secretKey: string;
}

export const generatePublicKey = (): string =>
  `${PUBLIC_KEY_PREFIX}${randomBytes(18).toString('base64url')}`;

export const generateSecretKey = (): string =>
  `${SECRET_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;

export function generateProjectKeys(): ProjectKeys {
  return { publicKey: generatePublicKey(), secretKey: generateSecretKey() };
}

/** The secret key is never stored in clear: its hash is stored and looked up. */
export function hashSecretKey(secretKey: string): string {
  return createHash('sha256').update(secretKey).digest('hex');
}
