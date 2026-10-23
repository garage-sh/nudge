import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { MembreVu } from '@nudge/shared';
import type { Request } from 'express';
import { readSessionCookie } from './session-cookie.js';
import { SessionsService } from './sessions.service.js';

export type MembreRequest = Request & { membre: MembreVu };

/**
 * Exige une session de Membre (cookie `nudge_session`) : 401 `session_requise` sinon.
 * Tout contrôleur du dashboard hors setup, connexion et invitation le porte.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(contexte: ExecutionContext): Promise<boolean> {
    const requete = contexte.switchToHttp().getRequest<MembreRequest>();
    const jeton = readSessionCookie(requete);
    const membre = jeton ? await this.sessions.resolve(jeton) : null;
    if (!membre) throw new UnauthorizedException({ erreur: 'session_requise' });
    requete.membre = membre;
    return true;
  }
}

/** Le Membre connecté, posé par `SessionGuard`. */
export const MembreCourant = createParamDecorator(
  (_: unknown, contexte: ExecutionContext): MembreVu =>
    contexte.switchToHttp().getRequest<MembreRequest>().membre,
);
