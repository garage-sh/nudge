import { argon2Sync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

const PASSWORD = 'a strong password';

/** A PHC hash of `PASSWORD` with the given argon2id parameters. */
function phc(memory: number, passes: number, parallelism: number, tagLength = 32): string {
  const nonce = randomBytes(16);
  const hash = argon2Sync('argon2id', {
    message: PASSWORD,
    nonce,
    memory,
    passes,
    parallelism,
    tagLength,
  });
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${nonce.toString('base64url')}$${hash.toString('base64url')}`;
}

describe('Passwords', () => {
  it('verifies the password it hashed, and only that one', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('another password', hash)).toBe(false);
  });

  it('verifies a hash with stronger parameters', async () => {
    expect(await verifyPassword(PASSWORD, phc(19_456, 3, 2))).toBe(true);
  });

  it.each([
    ['less memory', phc(8, 2, 1)],
    ['fewer passes', phc(19_456, 1, 1)],
    ['a shorter tag', phc(19_456, 2, 1, 16)],
  ])('refuses a hash downgraded to %s, even with the right password', async (_case, hash) => {
    expect(await verifyPassword(PASSWORD, hash)).toBe(false);
  });

  it('refuses an unreadable hash', async () => {
    expect(await verifyPassword(PASSWORD, 'not a hash')).toBe(false);
  });
});
