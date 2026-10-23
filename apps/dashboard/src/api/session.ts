import type { Connexion, EtatSetup, MembreVu, NouveauMembre, SessionVue } from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isSessionLost } from './client.js';

export const CLE_SESSION = ['session'] as const;
const CLE_SETUP = ['setup'] as const;

/** Le Membre connecté, `null` sans session ; `undefined` pendant le premier chargement. */
export function useSession() {
  return useQuery({
    queryKey: CLE_SESSION,
    queryFn: async (): Promise<MembreVu | null> => {
      try {
        return (await api.get<SessionVue>('/api/session')).membre;
      } catch (erreur) {
        if (isSessionLost(erreur)) return null;
        throw erreur;
      }
    },
    staleTime: Infinity,
  });
}

export function useEtatSetup(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: CLE_SETUP,
    queryFn: () => api.get<EtatSetup>('/api/setup'),
    enabled: options.enabled ?? true,
  });
}

/** Mutation qui ouvre une session (setup, connexion, invitation) et la met en cache. */
function useOuvertureSession<V>(appel: (variables: V) => Promise<SessionVue>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: appel,
    onSuccess: ({ membre }) => {
      client.setQueryData(CLE_SESSION, membre);
      client.setQueryData(CLE_SETUP, { requis: false } satisfies EtatSetup);
    },
  });
}

export const useSetup = () =>
  useOuvertureSession((membre: NouveauMembre) => api.post<SessionVue>('/api/setup', membre));

export const useConnexion = () =>
  useOuvertureSession((identifiants: Connexion) =>
    api.post<SessionVue>('/api/session', identifiants),
  );

export const useAcceptationInvitation = (jeton: string) =>
  useOuvertureSession((membre: NouveauMembre) =>
    api.post<SessionVue>(`/api/invitations/${encodeURIComponent(jeton)}/acceptation`, membre),
  );

export function useDeconnexion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<null>('/api/session'),
    onSuccess: () => {
      client.setQueryData(CLE_SESSION, null);
      // Plus rien de ce qui a été lu sous cette session ne doit rester en mémoire.
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== CLE_SESSION[0] });
    },
  });
}
