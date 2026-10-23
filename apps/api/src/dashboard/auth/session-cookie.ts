import { parse } from 'cookie';
import type { Request, Response } from 'express';

export const COOKIE_SESSION = 'nudge_session';

/** Durée de vie d'une session ; au-delà, le Membre se reconnecte. */
export const DUREE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionCookieOptions {
  /** `Secure` : le cookie ne circule qu'en HTTPS. À couper seulement en développement local. */
  readonly secure: boolean;
}

export function readSessionCookie(requete: Request): string | null {
  const entete = requete.headers.cookie;
  if (!entete) return null;
  return parse(entete)[COOKIE_SESSION] || null;
}

/**
 * httpOnly : le script de la page ne lit jamais le jeton. SameSite=Lax : un site
 * tiers ne fait pas porter la session à un POST/PATCH/DELETE (CSRF).
 */
const attributs = (options: SessionCookieOptions) =>
  ({ httpOnly: true, sameSite: 'lax', secure: options.secure, path: '/' }) as const;

export function writeSessionCookie(
  reponse: Response,
  jeton: string,
  options: SessionCookieOptions,
): void {
  reponse.cookie(COOKIE_SESSION, jeton, { ...attributs(options), maxAge: DUREE_SESSION_MS });
}

export function clearSessionCookie(reponse: Response, options: SessionCookieOptions): void {
  reponse.clearCookie(COOKIE_SESSION, attributs(options));
}
