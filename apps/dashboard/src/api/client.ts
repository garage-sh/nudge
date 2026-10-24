import type { ApiErrorBody } from '@nudge/shared';

/** Erreur rendue par l'API du dashboard : statut HTTP et code stable (`session_requise`…). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly corps: ApiErrorBody,
  ) {
    super(`${status} ${corps.erreur}`);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.corps.erreur;
  }
}

/** Une 401 de l'API : la session est absente, expirée ou révoquée. */
export const isSessionLost = (erreur: unknown): boolean =>
  erreur instanceof ApiError && erreur.status === 401;

type Methode = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Appel à l'API du dashboard (`/api/…`, même origine : le cookie de session
 * httpOnly part tout seul). Rend le corps JSON, ou lève une `ApiError`.
 */
export async function apiFetch<T>(methode: Methode, chemin: string, corps?: unknown): Promise<T> {
  const reponse = await fetch(chemin, {
    method: methode,
    credentials: 'same-origin',
    headers: {
      // Exigé par l'api sur toute écriture (défense CSRF) ; posé partout par simplicité.
      'x-nudge-client': 'dashboard',
      ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  const json: unknown = texte ? JSON.parse(texte) : null;
  if (!reponse.ok) {
    const code = (json as Partial<ApiErrorBody> | null)?.erreur;
    throw new ApiError(reponse.status, {
      ...(json as object),
      erreur: typeof code === 'string' ? code : 'erreur_inconnue',
    });
  }
  return json as T;
}

export const api = {
  get: <T>(chemin: string) => apiFetch<T>('GET', chemin),
  post: <T>(chemin: string, corps?: unknown) => apiFetch<T>('POST', chemin, corps),
  put: <T>(chemin: string, corps?: unknown) => apiFetch<T>('PUT', chemin, corps),
  patch: <T>(chemin: string, corps?: unknown) => apiFetch<T>('PATCH', chemin, corps),
  delete: <T>(chemin: string) => apiFetch<T>('DELETE', chemin),
};
