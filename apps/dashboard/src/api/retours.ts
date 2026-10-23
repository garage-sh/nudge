import type { PageRetours, RetourDetailVu } from '@nudge/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** Filtres de la boîte de réception, dans l'ordre où ils s'écrivent dans l'URL. */
export const FILTRES_RETOURS = [
  'projet',
  'type',
  'gravite',
  'etat',
  'source',
  'incertain',
] as const;
export type NomFiltre = (typeof FILTRES_RETOURS)[number];
/** Valeurs lues telles quelles dans l'URL : l'api les valide (400 sinon). */
export type FiltresRetours = Partial<Record<NomFiltre, string>>;

const cleListe = (filtres: FiltresRetours) => ['retours', 'liste', filtres] as const;
const cleRetour = (id: string) => ['retours', 'detail', id] as const;

function cheminRetours(filtres: FiltresRetours, curseur: string | null): string {
  const parametres = new URLSearchParams();
  for (const nom of FILTRES_RETOURS) {
    const valeur = filtres[nom];
    if (valeur) parametres.set(nom, valeur);
  }
  if (curseur) parametres.set('curseur', curseur);
  const requete = parametres.toString();
  return requete ? `/api/retours?${requete}` : '/api/retours';
}

/** La boîte de réception, page par page (du plus récent au plus ancien). */
export const useRetours = (filtres: FiltresRetours) =>
  useInfiniteQuery({
    queryKey: cleListe(filtres),
    queryFn: ({ pageParam }) => api.get<PageRetours>(cheminRetours(filtres, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.suivant,
  });

export const useRetour = (id: string) =>
  useQuery({
    queryKey: cleRetour(id),
    queryFn: () => api.get<RetourDetailVu>(`/api/retours/${encodeURIComponent(id)}`),
  });
