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
 * tiers ne peut pas faire porter la session à un POST/PATCH/DELETE (CSRF).
 */
export function writeSessionCookie(
  reponse: Response,
  jeton: string,
  options: SessionCookieOptions,
): void {
  reponse.cookie(COOKIE_SESSION, jeton, {
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure,
    path: '/',
    maxAge: DUREE_SESSION_MS,
  });
}

export function clearSessionCookie(reponse: Response, options: SessionCookieOptions): void {
  reponse.clearCookie(COOKIE_SESSION, {
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure,
    path: '/',
  });
}
