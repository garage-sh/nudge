import { Inject, Injectable } from '@nestjs/common';
import { membres, sessions, type Db } from '@nudge/database';
import type { MembreVu } from '@nudge/shared';
import { and, eq, gt, lte } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { generateJeton, hashJeton } from './jetons.js';
import { DUREE_SESSION_MS } from './session-cookie.js';

/** Sessions du dashboard, stockées en base : se déconnecter les révoque pour de bon. */
@Injectable()
export class SessionsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Ouvre une session et rend le jeton à poser dans le cookie. */
  async open(membreId: string): Promise<string> {
    const jeton = generateJeton();
    await this.db.insert(sessions).values({
      membreId,
      empreinteJeton: hashJeton(jeton),
      expireLe: new Date(Date.now() + DUREE_SESSION_MS),
    });
    return jeton;
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

  async close(jeton: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.empreinteJeton, hashJeton(jeton)));
    // Ménage opportuniste : les sessions expirées ne servent plus à rien.
    await this.db.delete(sessions).where(lte(sessions.expireLe, new Date()));
  }
}
