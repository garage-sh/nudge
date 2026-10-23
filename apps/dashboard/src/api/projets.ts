import type {
  ModificationProjet,
  NouveauProjet,
  ProjetAvecCleSecrete,
  ProjetVu,
} from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const CLE_PROJETS = ['projets'] as const;
const cleProjet = (id: string) => ['projets', id] as const;
const chemin = (id: string) => `/api/projets/${encodeURIComponent(id)}`;

export const useProjets = () =>
  useQuery({ queryKey: CLE_PROJETS, queryFn: () => api.get<ProjetVu[]>('/api/projets') });

export const useProjet = (id: string) =>
  useQuery({ queryKey: cleProjet(id), queryFn: () => api.get<ProjetVu>(chemin(id)) });

/** Range un Projet à jour dans le cache (détail) et invalide la liste. */
function useMiseAJourProjet() {
  const client = useQueryClient();
  return (projet: ProjetVu) => {
    client.setQueryData(cleProjet(projet.id), projet);
    void client.invalidateQueries({ queryKey: CLE_PROJETS, exact: true });
  };
}

export function useCreationProjet() {
  const ranger = useMiseAJourProjet();
  return useMutation({
    mutationFn: (projet: NouveauProjet) => api.post<ProjetAvecCleSecrete>('/api/projets', projet),
    onSuccess: ({ projet }) => ranger(projet),
  });
}

export function useModificationProjet(id: string) {
  const ranger = useMiseAJourProjet();
  return useMutation({
    mutationFn: (modification: ModificationProjet) => api.patch<ProjetVu>(chemin(id), modification),
    onSuccess: ranger,
  });
}

export function useRegenerationClePublique(id: string) {
  const ranger = useMiseAJourProjet();
  return useMutation({
    mutationFn: () => api.post<ProjetVu>(`${chemin(id)}/cle-publique`),
    onSuccess: ranger,
  });
}

export function useRegenerationCleSecrete(id: string) {
  const ranger = useMiseAJourProjet();
  return useMutation({
    mutationFn: () => api.post<ProjetAvecCleSecrete>(`${chemin(id)}/cle-secrete`),
    onSuccess: ({ projet }) => ranger(projet),
  });
}
