import { parse } from 'cookie';
import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'nudge_session';

/** Lifetime of a session; beyond it, the Member signs in again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionCookieOptions {
  /** `Secure`: the cookie only travels over HTTPS. Turn off only for local development. */
  readonly secure: boolean;
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  return parse(header)[SESSION_COOKIE] || null;
}

/**
 * httpOnly: the page's script never reads the token. SameSite=Lax: a third-party site
 * does not make a POST/PATCH/DELETE carry the session (CSRF).
 */
const attributes = (options: SessionCookieOptions) =>
  ({ httpOnly: true, sameSite: 'lax', secure: options.secure, path: '/' }) as const;

export function writeSessionCookie(
  response: Response,
  token: string,
  options: SessionCookieOptions,
): void {
  response.cookie(SESSION_COOKIE, token, { ...attributes(options), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(response: Response, options: SessionCookieOptions): void {
  response.clearCookie(SESSION_COOKIE, attributes(options));
}
