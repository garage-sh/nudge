import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** argon2id parameters recommended by OWASP (19 MiB, 2 passes, 1 lane). */
const PARAMETERS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

type Argon2Settings = Pick<Argon2Parameters, 'memory' | 'passes' | 'parallelism' | 'tagLength'>;

const derive = (password: string, nonce: Buffer, parameters: Argon2Settings) =>
  argon2Async('argon2id', { message: password, nonce, ...parameters });

/** argon2id hash in PHC format: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const hash = await derive(password, nonce, PARAMETERS);
  const { memory, passes, parallelism } = PARAMETERS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${nonce.toString('base64url')}$${hash.toString('base64url')}`;
}

const PHC_FORMAT = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/;

/** Compares in constant time; an unreadable hash never verifies. */
export async function verifyPassword(password: string, phcHash: string): Promise<boolean> {
  const parts = PHC_FORMAT.exec(phcHash);
  if (!parts) return false;
  const [, memory, passes, parallelism, nonce, hash] = parts;
  const expected = Buffer.from(hash!, 'base64url');
  const computed = await derive(password, Buffer.from(nonce!, 'base64url'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return timingSafeEqual(expected, computed);
}
