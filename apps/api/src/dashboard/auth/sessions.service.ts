import { Inject, Injectable } from '@nestjs/common';
import { members, sessions, type Db } from '@nudge/database';
import type { MemberView } from '@nudge/shared';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DB, SESSION_COOKIE_OPTIONS } from '../../infra/tokens.js';
import { generateToken, hashToken } from './tokens.js';
import {
  clearSessionCookie,
  SESSION_TTL_MS,
  readSessionCookie,
  writeSessionCookie,
  type SessionCookieOptions,
} from './session-cookie.js';

/** Dashboard sessions, stored in the database: signing out revokes them for good. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SESSION_COOKIE_OPTIONS) private readonly cookie: SessionCookieOptions,
  ) {}

  /** Opens a session for the Member and sets its cookie on the response. */
  async start(response: Response, member: MemberView): Promise<void> {
    const token = generateToken();
    await this.db.insert(sessions).values({
      memberId: member.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    writeSessionCookie(response, token, this.cookie);
  }

  /** Revokes the request's session, if there is one, and clears the cookie. */
  async end(request: Request, response: Response): Promise<void> {
    const token = readSessionCookie(request);
    if (token) await this.close(token);
    clearSessionCookie(response, this.cookie);
  }

  /** The Member of a valid session, or `null` (token unknown, revoked or expired). */
  async resolve(token: string): Promise<MemberView | null> {
    const [found] = await this.db
      .select({ id: members.id, email: members.email })
      .from(sessions)
      .innerJoin(members, eq(members.id, sessions.memberId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return found ?? null;
  }

  private async close(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    // Opportunistic cleanup: expired sessions are of no use any more.
    await this.db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
  }
}
