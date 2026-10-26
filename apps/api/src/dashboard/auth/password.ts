import { ServiceUnavailableException } from '@nestjs/common';
import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { promisify } from 'node:util';
import { ConcurrencyLimit } from '../../infra/concurrency-limit.js';

const argon2Async = promisify(argon2);

/** argon2id parameters recommended by OWASP (19 MiB, 2 passes, 1 lane). */
const PARAMETERS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

type Argon2Settings = Pick<Argon2Parameters, 'memory' | 'passes' | 'parallelism' | 'tagLength'>;

/**
 * A derivation holds a libuv thread for about 40 ms, and the pool (4 threads) also
 * serves disk Captures and DNS lookups: two at once, whatever the number of IPs
 * asking. Beyond the queue, 503 `server_busy` at once rather than an endless wait.
 */
const derivations = new ConcurrencyLimit({ concurrency: 2, waiting: 32 });

async function derive(password: string, nonce: Buffer, parameters: Argon2Settings) {
  const release = await derivations.acquire();
  if (!release) throw new ServiceUnavailableException({ error: 'server_busy' });
  try {
    return await argon2Async('argon2id', { message: password, nonce, ...parameters });
  } finally {
    release();
  }
}

/** argon2id hash in PHC format: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const hash = await derive(password, nonce, PARAMETERS);
  const { memory, passes, parallelism } = PARAMETERS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${nonce.toString('base64url')}$${hash.toString('base64url')}`;
}

const PHC_FORMAT = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/;

/**
 * Compares in constant time; an unreadable hash never verifies, nor does one whose
 * parameters are weaker than `PARAMETERS`: whoever writes to the database cannot
 * silently downgrade a Member's hash.
 */
export async function verifyPassword(password: string, phcHash: string): Promise<boolean> {
  const parts = PHC_FORMAT.exec(phcHash);
  if (!parts) return false;
  const [, memory, passes, parallelism, nonce, hash] = parts;
  const expected = Buffer.from(hash!, 'base64url');
  const parameters = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  };
  if (
    parameters.memory < PARAMETERS.memory ||
    parameters.passes < PARAMETERS.passes ||
    parameters.parallelism < PARAMETERS.parallelism ||
    parameters.tagLength < PARAMETERS.tagLength
  ) {
    return false;
  }
  const computed = await derive(password, Buffer.from(nonce!, 'base64url'), parameters);
  return timingSafeEqual(expected, computed);
}
