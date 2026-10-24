import type {
  DestinationAvecSecretsGeneres,
  DestinationVu,
  ModificationDestination,
  NouvelleDestination,
  ResultatTestDestination,
} from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const cleDestinations = (projetId: string) => ['projets', projetId, 'destinations'] as const;
const chemin = (id: string) => `/api/destinations/${encodeURIComponent(id)}`;

export const useDestinations = (projetId: string) =>
  useQuery({
    queryKey: cleDestinations(projetId),
    queryFn: () =>
      api.get<DestinationVu[]>(`/api/projets/${encodeURIComponent(projetId)}/destinations`),
  });

/** Range une Destination à jour dans la liste du Projet (`null` : retirée). */
function useRangement(projetId: string) {
  const client = useQueryClient();
  return (id: string, destination: DestinationVu | null) =>
    client.setQueryData<DestinationVu[]>(cleDestinations(projetId), (liste = []) => {
      const autres = liste.filter((d) => d.id !== id);
      if (!destination) return autres;
      const index = liste.findIndex((d) => d.id === id);
      return index === -1
        ? [...liste, destination]
        : liste.map((d) => (d.id === id ? destination : d));
    });
}

export function useCreationDestination(projetId: string) {
  const ranger = useRangement(projetId);
  return useMutation({
    mutationFn: (nouvelle: NouvelleDestination) =>
      api.post<DestinationAvecSecretsGeneres>(
        `/api/projets/${encodeURIComponent(projetId)}/destinations`,
        nouvelle,
      ),
    onSuccess: ({ destination }) => ranger(destination.id, destination),
  });
}

export function useModificationDestination(projetId: string, id: string) {
  const ranger = useRangement(projetId);
  return useMutation({
    mutationFn: (modification: ModificationDestination) =>
      api.patch<DestinationVu>(chemin(id), modification),
    onSuccess: (destination) => ranger(id, destination),
  });
}

export function useSuppressionDestination(projetId: string, id: string) {
  const ranger = useRangement(projetId);
  return useMutation({
    mutationFn: () => api.delete<null>(chemin(id)),
    onSuccess: () => ranger(id, null),
  });
}

export function useRegenerationSecretsGeneres(projetId: string, id: string) {
  const ranger = useRangement(projetId);
  return useMutation({
    mutationFn: () => api.post<DestinationAvecSecretsGeneres>(`${chemin(id)}/secrets-generes`),
    onSuccess: ({ destination }) => ranger(id, destination),
  });
}

/** Envoie un Retour d'exemple ; le résultat (livré ou échec) est une réponse 200. */
export const useTestDestination = (id: string) =>
  useMutation({
    mutationFn: () => api.post<ResultatTestDestination>(`${chemin(id)}/test`),
  });
