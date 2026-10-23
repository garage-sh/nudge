import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, isSessionLost } from './client.js';
import { CLE_SESSION } from './session.js';

/**
 * Client de requêtes du dashboard. Toute 401, sur une lecture ou une écriture,
 * vide la session en cache : `RequireSession` renvoie alors vers la connexion.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (erreur) => perdreSession(erreur) }),
    mutationCache: new MutationCache({ onError: (erreur) => perdreSession(erreur) }),
    defaultOptions: {
      queries: {
        // Une réponse de l'API est définitive ; seule une panne réseau mérite un nouvel essai.
        retry: (echecs, erreur) => !(erreur instanceof ApiError) && echecs < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
  const perdreSession = (erreur: unknown) => {
    if (isSessionLost(erreur)) client.setQueryData(CLE_SESSION, null);
  };
  return client;
}
