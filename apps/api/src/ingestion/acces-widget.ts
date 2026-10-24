import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Projet } from '@nudge/database';
import { RateLimiter, type RateLimit } from '../infra/rate-limiter.js';

/** Rate limit de l'ingestion par clé publique (D8 : en mémoire, par réplique d'api). */
export interface LimitesWidget {
  readonly parIp: RateLimit;
  readonly parProjet: RateLimit;
}

/**
 * Par défaut : 20 Retours par minute pour une IP (tous Projets confondus), 600 par
 * minute pour un Projet. Un Auteur n'écrit pas vingt Retours par minute ; un Projet
 * qui en reçoit dix par seconde est inondé.
 */
export const LIMITES_WIDGET_PAR_DEFAUT: LimitesWidget = {
  parIp: { limit: 20, windowMs: 60_000 },
  parProjet: { limit: 600, windowMs: 60_000 },
};

export const LIMITES_WIDGET = Symbol('LIMITES_WIDGET');

/**
 * Garde-fous de la voie Widget : l'origine de la page doit figurer parmi les Origines
 * autorisées du Projet, et le débit est borné par IP et par Projet.
 *
 * L'en-tête Origin n'est une protection que contre un autre site dans un navigateur :
 * un client hors navigateur le forge. Le rate limit borne ce qu'il peut envoyer.
 */
@Injectable()
export class AccesWidget {
  private readonly parIp: RateLimiter;
  private readonly parProjet: RateLimiter;

  constructor(@Inject(LIMITES_WIDGET) limites: LimitesWidget) {
    this.parIp = new RateLimiter(limites.parIp);
    this.parProjet = new RateLimiter(limites.parProjet);
  }

  /** Compte une tentative de l'IP, avant même de chercher la clé. */
  limiterIp(ip: string | undefined): void {
    limiter(this.parIp, ip ?? 'inconnue');
  }

  /** L'origine exacte (schéma, hôte, port) doit être autorisée ; une requête sans origine ne l'est pas. */
  verifierOrigine(projet: Projet, origine: string | undefined): void {
    if (!origine || !projet.originesAutorisees.includes(origine)) {
      throw new ForbiddenException({ erreur: 'origine_refusee' });
    }
  }

  /** Compte un Retour du Projet, une fois la clé et l'origine admises. */
  limiterProjet(projetId: string): void {
    limiter(this.parProjet, projetId);
  }
}

function limiter(limiteur: RateLimiter, cle: string): void {
  if (limiteur.consume(cle)) return;
  const secondes = Math.max(1, Math.ceil(limiteur.msUntilReset(cle) / 1000));
  throw new TropDeRetours(secondes);
}

/** 429 avec `Retry-After` : le Widget peut dire à l'Auteur quand réessayer. */
export class TropDeRetours extends HttpException {
  constructor(readonly retryAfterSecondes: number) {
    super({ erreur: 'trop_de_retours' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
