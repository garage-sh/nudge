import { createHash, randomBytes } from 'node:crypto';

/** Jeton opaque (session, invitation) ; seule son empreinte est stockée. */
export const generateJeton = (): string => randomBytes(32).toString('base64url');

export const hashJeton = (jeton: string): string =>
  createHash('sha256').update(jeton).digest('hex');
