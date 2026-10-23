import { Inject, Injectable } from '@nestjs/common';
import { membres, sessions, type Db } from '@nudge/database';
import type { MembreVu } from '@nudge/shared';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DB, SESSION_COOKIE_OPTIONS } from '../../infra/tokens.js';
import { generateJeton, hashJeton } from './jetons.js';
import {
  clearSessionCookie,
  DUREE_SESSION_MS,
  readSessionCookie,
  writeSessionCookie,
  type SessionCookieOptions,
} from './session-cookie.js';

/** Sessions du dashboard, stockées en base : se déconnecter les révoque pour de bon. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SESSION_COOKIE_OPTIONS) private readonly cookie: SessionCookieOptions,
  ) {}

  /** Ouvre une session pour le Membre et pose son cookie sur la réponse. */
  async start(reponse: Response, membre: MembreVu): Promise<void> {
    const jeton = generateJeton();
    await this.db.insert(sessions).values({
      membreId: membre.id,
      empreinteJeton: hashJeton(jeton),
      expireLe: new Date(Date.now() + DUREE_SESSION_MS),
    });
    writeSessionCookie(reponse, jeton, this.cookie);
  }

  /** Révoque la session de la requête, s'il y en a une, et efface le cookie. */
  async end(requete: Request, reponse: Response): Promise<void> {
    const jeton = readSessionCookie(requete);
    if (jeton) await this.close(jeton);
    clearSessionCookie(reponse, this.cookie);
  }

  /** Le Membre d'une session valide, ou `null` (jeton inconnu, révoqué ou expiré). */
  async resolve(jeton: string): Promise<MembreVu | null> {
    const [trouve] = await this.db
      .select({ id: membres.id, email: membres.email })
      .from(sessions)
      .innerJoin(membres, eq(membres.id, sessions.membreId))
      .where(and(eq(sessions.empreinteJeton, hashJeton(jeton)), gt(sessions.expireLe, new Date())))
      .limit(1);
    return trouve ?? null;
  }

  private async close(jeton: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.empreinteJeton, hashJeton(jeton)));
    // Ménage opportuniste : les sessions expirées ne servent plus à rien.
    await this.db.delete(sessions).where(lte(sessions.expireLe, new Date()));
  }
}
