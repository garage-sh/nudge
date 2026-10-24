import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { hashCleSecrete, PREFIXE_CLE_PUBLIQUE } from '@nudge/core';
import { projets, type Db, type Projet } from '@nudge/database';
import type { Source } from '@nudge/shared';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DB } from '../infra/tokens.js';
import { AccesWidget, TropDeRetours } from './acces-widget.js';

export type AuthenticatedRequest = Request & { projet: Projet; source: Source };

/**
 * Authentifie l'appel par une clé du Projet (`Authorization: Bearer <clé>`) et en
 * déduit la Source :
 * - clé publique (`nk_pub_…`) : le Widget, depuis une Origine autorisée, débit borné ;
 * - clé secrète (`nk_sec_…`) : l'API serveur.
 */
@Injectable()
export class CleProjetGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly accesWidget: AccesWidget,
  ) {}

  async canActivate(contexte: ExecutionContext): Promise<boolean> {
    const http = contexte.switchToHttp();
    const requete = http.getRequest<AuthenticatedRequest>();
    const [schema, cle] = (requete.headers.authorization ?? '').split(' ');
    if (schema !== 'Bearer' || !cle) throw new UnauthorizedException({ erreur: 'cle_manquante' });
    if (!cle.startsWith(PREFIXE_CLE_PUBLIQUE)) {
      requete.projet = await this.projet(eq(projets.empreinteCleSecrete, hashCleSecrete(cle)));
      requete.source = 'api';
      return true;
    }
    try {
      this.accesWidget.limiterIp(requete.ip);
      const projet = await this.projet(eq(projets.clePublique, cle));
      this.accesWidget.verifierOrigine(projet, requete.headers.origin);
      this.accesWidget.limiterProjet(projet.id);
      requete.projet = projet;
      requete.source = 'widget';
      return true;
    } catch (erreur) {
      if (erreur instanceof TropDeRetours) {
        http.getResponse<Response>().setHeader('Retry-After', String(erreur.retryAfterSecondes));
      }
      throw erreur;
    }
  }

  private async projet(condition: ReturnType<typeof eq>): Promise<Projet> {
    const [projet] = await this.db.select().from(projets).where(condition).limit(1);
    if (!projet) throw new UnauthorizedException({ erreur: 'cle_invalide' });
    return projet;
  }
}
