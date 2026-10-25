import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Instance key (D7): 32 bytes in base64, provided by the environment and never stored
 * in the database. Generate: `openssl rand -base64 32`.
 */
export const ENCRYPTION_KEY_VARIABLE = 'NUDGE_ENCRYPTION_KEY';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** An unreadable encrypted secret: wrong key, other use, tampered or malformed value. */
export class SecretDecryptionError extends Error {
  override readonly name = 'SecretDecryptionError';
}

/**
 * Encrypts the secrets stored in the database (the Judge's key, Destination tokens, HMAC
 * secrets). The `context` names the secret's use (`instance_settings.judge_key`,
 * `destinations.<id>.secrets`…): it is authenticated along with it, so a secret copied
 * into another column or another row does not decrypt.
 */
export interface SecretCipher {
  /** `v1:<iv>:<tag>:<data>`, in base64. */
  encrypt(plaintext: string, context: string): string;
  /** Throws `SecretDecryptionError` if the secret does not decrypt for this context. */
  decrypt(encrypted: string, context: string): string;
}

/** Throws if the key is not 32 bytes in base64. */
export function createSecretCipher(keyBase64: string): SecretCipher {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${ENCRYPTION_KEY_VARIABLE} must contain 32 bytes in base64 (${key.length} read): openssl rand -base64 32`,
    );
  }
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), data]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
        .join(':');
    },
    decrypt(encrypted, context) {
      const [version, iv, tag, data, ...rest] = encrypted.split(':');
      if (version !== VERSION || !iv || !tag || data === undefined || rest.length > 0) {
        throw new SecretDecryptionError('Malformed encrypted secret');
      }
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([
          decipher.update(Buffer.from(data, 'base64')),
          decipher.final(),
        ]).toString('utf8');
      } catch (cause) {
        throw new SecretDecryptionError(
          `Undecryptable secret ("${context}"): other Instance key, other use or tampered value`,
          { cause },
        );
      }
    },
  };
}
