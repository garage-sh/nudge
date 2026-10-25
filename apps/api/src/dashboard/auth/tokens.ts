import { createHash, randomBytes } from 'node:crypto';

/** Opaque token (session, invitation); only its hash is stored. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
