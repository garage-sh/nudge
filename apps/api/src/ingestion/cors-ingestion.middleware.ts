import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * CORS de l'API publique, pour le Widget servi depuis la page d'un Projet.
 *
 * L'origine est renvoyée telle quelle : la lecture de la réponse n'est pas ce qui
 * protège l'ingestion. C'est l'écriture qui est refusée (403 `origine_refusee`) quand
 * l'origine n'est pas autorisée pour la clé publique, et le Widget peut alors lire
 * pourquoi. Pas de cookie (`credentials`) : la clé est dans l'en-tête Authorization.
 * Un preflight ne porte pas la clé : il ne peut pas être vérifié contre le Projet.
 */
@Injectable()
export class CorsIngestionMiddleware implements NestMiddleware {
  use(requete: Request, reponse: Response, suite: NextFunction): void {
    const origine = requete.headers.origin;
    reponse.vary('Origin');
    if (origine) reponse.setHeader('Access-Control-Allow-Origin', origine);
    // Le Widget dit à l'Auteur quand réessayer après un 429.
    reponse.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    if (requete.method !== 'OPTIONS') return suite();
    reponse.setHeader('Access-Control-Allow-Methods', 'POST');
    reponse.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reponse.setHeader('Access-Control-Max-Age', '600');
    reponse.status(204).end();
  }
}
