import { vi } from 'vitest';

/** Réponse scriptée : statut et corps JSON, ou fonction du corps reçu. */
export type ReponseFactice =
  { status: number; body?: unknown } | ((corps: unknown) => { status: number; body?: unknown });

/**
 * API du dashboard factice, branchée à la frontière réseau (`fetch`) :
 * chaque route `"MÉTHODE /chemin"` rend la réponse scriptée ; toute autre, 404.
 * `appels` garde les requêtes reçues, pour vérifier ce que l'écran a envoyé.
 */
export function fakeApi(routes: Record<string, ReponseFactice>) {
  const appels: { route: string; corps: unknown }[] = [];
  const table = { ...routes };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entree: string, init: RequestInit = {}) => {
      const route = `${init.method ?? 'GET'} ${entree}`;
      const corps = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      appels.push({ route, corps });
      const scriptee = table[route];
      const { status, body } =
        typeof scriptee === 'function'
          ? scriptee(corps)
          : (scriptee ?? { status: 404, body: { erreur: 'route_inconnue' } });
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }),
  );
  return {
    appels,
    /** Remplace la réponse d'une route en cours de test. */
    set(route: string, reponse: ReponseFactice) {
      table[route] = reponse;
    },
  };
}

export const MEMBRE = { id: 'membre-1', email: 'ada@nudge.test' };

export const SANS_SESSION = { status: 401, body: { erreur: 'session_requise' } };
export const CONNECTE = { status: 200, body: { membre: MEMBRE } };
