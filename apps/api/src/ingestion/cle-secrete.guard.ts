import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { hashCleSecrete } from '@nudge/core';
import { projets, type Db, type Projet } from '@nudge/database';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB } from '../infra/tokens.js';

export type AuthenticatedRequest = Request & { projet: Projet };

/** Authentifie l'appel serveur par la clé secrète du Projet (`Authorization: Bearer nk_sec_…`). */
@Injectable()
export class CleSecreteGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(contexte: ExecutionContext): Promise<boolean> {
    const requete = contexte.switchToHttp().getRequest<AuthenticatedRequest>();
    const [schema, cle] = (requete.headers.authorization ?? '').split(' ');
    if (schema !== 'Bearer' || !cle) throw new UnauthorizedException({ erreur: 'cle_manquante' });
    const [projet] = await this.db
      .select()
      .from(projets)
      .where(eq(projets.empreinteCleSecrete, hashCleSecrete(cle)))
      .limit(1);
    if (!projet) throw new UnauthorizedException({ erreur: 'cle_invalide' });
    requete.projet = projet;
    return true;
  }
}
