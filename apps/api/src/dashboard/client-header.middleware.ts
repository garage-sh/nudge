import { ForbiddenException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** En-tête que le dashboard pose sur chacune de ses requêtes. */
export const EN_TETE_CLIENT = 'x-nudge-client';

const LECTURES = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Défense CSRF en plus de SameSite=Lax : une écriture doit porter l'en-tête du
 * dashboard. Un formulaire tiers ne sait pas le poser, et un script d'une autre
 * origine (même un sous-domaine « same-site ») déclenche un preflight CORS que
 * l'api ne valide pas.
 */
@Injectable()
export class ClientHeaderMiddleware implements NestMiddleware {
  use(requete: Request, _reponse: Response, suite: NextFunction): void {
    if (!LECTURES.has(requete.method) && requete.headers[EN_TETE_CLIENT] !== 'dashboard') {
      throw new ForbiddenException({ erreur: 'en_tete_manquant' });
    }
    suite();
  }
}
