import type { ClasseEchec } from '@nudge/core';
import { tronquer } from './texte.js';

/** Longueur maximale de la réponse d'un service externe reprise dans un message d'échec. */
export const EXTRAIT_MAX = 300;

/** Délai de réponse d'un service externe, au-delà duquel l'appel est un échec transitoire. */
export const DELAI_HTTP_PAR_DEFAUT_MS = 10_000;

/**
 * Classe d'un statut HTTP d'échec, commune aux Destinations appelées en HTTP :
 * 408, 425, 429 et 5xx sont passagers ; 401 et 403 refusent les identifiants ;
 * tout autre refus vise cette requête précise.
 */
export function classerStatut(status: number): ClasseEchec {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient';
  if (status === 401 || status === 403) return 'auth';
  return 'permanent';
}

/**
 * Classe et message d'une réponse HTTP d'échec. Les redirections ne sont jamais
 * suivies (`redirect: 'manual'`) : un 3xx est permanent, il faut configurer l'URL finale.
 */
export async function echecHttp(
  reponse: Response,
  classer: (status: number) => ClasseEchec = classerStatut,
): Promise<{ classe: ClasseEchec; message: string }> {
  if (reponse.status >= 300 && reponse.status < 400) {
    await reponse.body?.cancel();
    return {
      classe: 'permanent',
      message: `HTTP ${reponse.status} : redirection refusée, configurez l'URL finale`,
    };
  }
  return { classe: classer(reponse.status), message: await messageEchec(reponse) };
}

/** « 422 : <début de la réponse> », borné. */
export async function messageEchec(reponse: Response): Promise<string> {
  const texte = (await reponse.text().catch(() => '')).trim();
  const extrait = tronquer(texte, EXTRAIT_MAX);
  return extrait ? `HTTP ${reponse.status} : ${extrait}` : `HTTP ${reponse.status}`;
}

/** Message d'une exception de `fetch` (réseau, délai dépassé). */
export const messageErreur = (erreur: unknown): string =>
  erreur instanceof Error ? erreur.message : String(erreur);
