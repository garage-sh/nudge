import type { ErreurApiCorps } from '@nudge/shared';

/** Erreur rendue par l'API du dashboard : statut HTTP et code stable (`session_requise`…). */
export class ErreurApi extends Error {
  constructor(
    readonly status: number,
    readonly corps: ErreurApiCorps,
  ) {
    super(`${status} ${corps.erreur}`);
    this.name = 'ErreurApi';
  }

  get code(): string {
    return this.corps.erreur;
  }
}

/** Une 401 de l'API : la session est absente, expirée ou révoquée. */
export const isSessionPerdue = (erreur: unknown): boolean =>
  erreur instanceof ErreurApi && erreur.status === 401;

type Methode = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Appel à l'API du dashboard (`/api/…`, même origine : le cookie de session
 * httpOnly part tout seul). Rend le corps JSON, ou lève une `ErreurApi`.
 */
export async function apiFetch<T>(methode: Methode, chemin: string, corps?: unknown): Promise<T> {
  const reponse = await fetch(chemin, {
    method: methode,
    credentials: 'same-origin',
    headers: corps === undefined ? undefined : { 'content-type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  const json: unknown = texte ? JSON.parse(texte) : null;
  if (!reponse.ok) {
    const code = (json as Partial<ErreurApiCorps> | null)?.erreur;
    throw new ErreurApi(reponse.status, {
      ...(json as object),
      erreur: typeof code === 'string' ? code : 'erreur_inconnue',
    });
  }
  return json as T;
}

export const api = {
  get: <T>(chemin: string) => apiFetch<T>('GET', chemin),
  post: <T>(chemin: string, corps?: unknown) => apiFetch<T>('POST', chemin, corps),
  patch: <T>(chemin: string, corps?: unknown) => apiFetch<T>('PATCH', chemin, corps),
  delete: <T>(chemin: string) => apiFetch<T>('DELETE', chemin),
};
