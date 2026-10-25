import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretCipher, SecretDecryptionError } from './secrets.js';

const key = () => randomBytes(32).toString('base64');

describe('Secret encryption (Instance key, AES-256-GCM)', () => {
  it('makes the encrypted secret unreadable, and returns it unchanged on decryption', () => {
    const cipher = createSecretCipher(key());
    const encrypted = cipher.encrypt('sk-or-v1-secret', 'judge.key');

    expect(encrypted).not.toContain('sk-or-v1-secret');
    expect(cipher.decrypt(encrypted, 'judge.key')).toBe('sk-or-v1-secret');
  });

  it('encrypts the same secret twice into two different values', () => {
    const cipher = createSecretCipher(key());
    expect(cipher.encrypt('same secret', 'x')).not.toBe(cipher.encrypt('same secret', 'x'));
  });

  it('refuses a secret encrypted for another use, or with another key', () => {
    const cipher = createSecretCipher(key());
    const encrypted = cipher.encrypt('token', 'destination.1.token');

    expect(() => cipher.decrypt(encrypted, 'destination.2.token')).toThrow(SecretDecryptionError);
    expect(() => createSecretCipher(key()).decrypt(encrypted, 'destination.1.token')).toThrow(
      SecretDecryptionError,
    );
  });

  it('refuses a tampered or malformed secret', () => {
    const cipher = createSecretCipher(key());
    const encrypted = cipher.encrypt('token', 'x');
    const [version, iv, tag, data] = encrypted.split(':');
    const tampered = Buffer.from(data!, 'base64');
    tampered[0] = tampered[0]! ^ 1;

    expect(() =>
      cipher.decrypt([version, iv, tag, tampered.toString('base64')].join(':'), 'x'),
    ).toThrow(SecretDecryptionError);
    expect(() => cipher.decrypt('not-an-encrypted-secret', 'x')).toThrow(SecretDecryptionError);
  });

  it('requires a 32-byte base64 key, and says which one', () => {
    expect(() => createSecretCipher('')).toThrow(/NUDGE_ENCRYPTION_KEY/);
    expect(() => createSecretCipher(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
