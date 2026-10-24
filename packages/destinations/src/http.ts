import type { ClasseEchec } from '@nudge/core';

/** Longueur maximale de la réponse d'un service externe reprise dans un message d'échec. */
const EXTRAIT_MAX = 300;

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

/** « 422 : <début de la réponse> », borné. */
export async function messageEchec(reponse: Response): Promise<string> {
  const texte = (await reponse.text().catch(() => '')).trim();
  const extrait = texte.length > EXTRAIT_MAX ? `${texte.slice(0, EXTRAIT_MAX)}…` : texte;
  return extrait ? `HTTP ${reponse.status} : ${extrait}` : `HTTP ${reponse.status}`;
}

/** Message d'une exception de `fetch` (réseau, délai dépassé). */
export const messageErreur = (erreur: unknown): string =>
  erreur instanceof Error ? erreur.message : String(erreur);
