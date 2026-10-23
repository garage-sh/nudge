import { vi } from 'vitest';

/** Réponse scriptée : statut et corps JSON, ou fonction du corps reçu. */
export type ReponseFactice =
  { status: number; body?: unknown } | ((corps: unknown) => { status: number; body?: unknown });

/**
 * API du dashboard factice, branchée à la frontière réseau (`fetch`) :
 * chaque route `"MÉTHODE /chemin"` rend la réponse scriptée ; toute autre, 404.
 * Comme l'api, il refuse (403) une écriture sans l'en-tête `x-nudge-client`.
 * `appels` garde les requêtes reçues, pour vérifier ce que l'écran a envoyé.
 */
export function fakeApi(routes: Record<string, ReponseFactice>) {
  const appels: { route: string; corps: unknown }[] = [];
  const table = { ...routes };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entree: string, init: RequestInit = {}) => {
      const methode = init.method ?? 'GET';
      const route = `${methode} ${entree}`;
      const enTete = new Headers(init.headers).get('x-nudge-client');
      if (methode !== 'GET' && enTete !== 'dashboard') {
        // Comme l'api : une écriture sans l'en-tête du dashboard est refusée.
        return new Response(JSON.stringify({ erreur: 'en_tete_manquant' }), { status: 403 });
      }
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
