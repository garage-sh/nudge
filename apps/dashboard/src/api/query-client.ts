import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, isSessionLost } from './client.js';
import { SESSION_KEY } from './session.js';

/**
 * The dashboard's query client. Any 401, on a read or a write, clears the cached
 * session: `RequireSession` then sends back to sign in.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => loseSession(error) }),
    mutationCache: new MutationCache({ onError: (error) => loseSession(error) }),
    defaultOptions: {
      queries: {
        // An API response is final; only a network failure deserves another try.
        retry: (failures, error) => !(error instanceof ApiError) && failures < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
  const loseSession = (error: unknown) => {
    if (isSessionLost(error)) client.setQueryData(SESSION_KEY, null);
  };
  return client;
}
