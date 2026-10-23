import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { RateLimiter } from '../../infra/rate-limiter.js';

/**
 * Freine la force brute sur les routes publiques qui hachent un mot de passe
 * (setup, connexion, invitation) : 10 tentatives par minute, par route et par IP.
 * Derrière un proxy, l'IP n'est la bonne que si `trust proxy` est réglé.
 */
@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private readonly limiteur = new RateLimiter({ limit: 10, windowMs: 60_000 });

  canActivate(contexte: ExecutionContext): boolean {
    const requete = contexte.switchToHttp().getRequest<Request>();
    const route = `${contexte.getClass().name}.${contexte.getHandler().name}`;
    if (this.limiteur.consume(`${route}:${requete.ip ?? 'inconnue'}`)) return true;
    throw new HttpException({ erreur: 'trop_de_tentatives' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
