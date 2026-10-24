import type {
  ActionRevue,
  CorrectionVerdict,
  EnvoiVu,
  PageRetours,
  RetourDetailVu,
} from '@nudge/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLE_ALERTES } from './alertes.js';
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

/** Préfixe de toutes les pages de la boîte de réception, quels que soient les filtres. */
const CLE_LISTES = ['retours', 'liste'] as const;
const cleListe = (filtres: FiltresRetours) => [...CLE_LISTES, filtres] as const;
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

const cheminRetour = (id: string) => `/api/retours/${encodeURIComponent(id)}`;

/** Intervalle de rafraîchissement d'un Retour dont le traitement suit son cours. */
const SUIVI_MS = 2000;

/** Le Triage ou un Envoi est en cours : l'état lu va changer sans action du Membre. */
const enCours = (retour: RetourDetailVu): boolean =>
  retour.etat === 'recu' || retour.envois.some((envoi) => envoi.statut === 'en_attente');

/**
 * Le détail d'un Retour, rafraîchi tant que son traitement suit son cours, et jusqu'à
 * `suivreJusqua` (instant, en ms) : après une revue, le Dispatch qui suit n'a pas
 * encore créé d'Envoi.
 */
export const useRetour = (id: string, { suivreJusqua = 0 } = {}) =>
  useQuery({
    queryKey: cleRetour(id),
    queryFn: () => api.get<RetourDetailVu>(cheminRetour(id)),
    refetchInterval: (query) => {
      const retour = query.state.data;
      if (!retour) return false;
      return enCours(retour) || Date.now() < suivreJusqua ? SUIVI_MS : false;
    },
  });

/**
 * Après une action sur un Retour : range le Retour à jour s'il est rendu (sinon le
 * relit, par exemple après un refus parce qu'il a changé entre-temps), et rafraîchit
 * la boîte de réception.
 */
function useApresAction(id: string) {
  const client = useQueryClient();
  return (retour?: RetourDetailVu) => {
    if (retour) client.setQueryData(cleRetour(id), retour);
    else void client.invalidateQueries({ queryKey: cleRetour(id) });
    void client.invalidateQueries({ queryKey: CLE_LISTES });
    // Un Retour revu quitte les badges « en revue ».
    void client.invalidateQueries({ queryKey: CLE_ALERTES });
  };
}

/** Valider ou rejeter un Retour En revue, réhabiliter un Retour Indésirable. */
export function useRevue(id: string) {
  const apres = useApresAction(id);
  return useMutation({
    mutationFn: (action: ActionRevue) =>
      api.post<RetourDetailVu>(`${cheminRetour(id)}/revue`, { action }),
    onSettled: (retour) => apres(retour),
  });
}

/** Corriger le Type retenu et / ou la Gravité du Verdict. */
export function useCorrectionVerdict(id: string) {
  const apres = useApresAction(id);
  return useMutation({
    mutationFn: (correction: CorrectionVerdict) =>
      api.patch<RetourDetailVu>(`${cheminRetour(id)}/verdict`, correction),
    onSettled: (retour) => apres(retour),
  });
}

/** Rejouer un Envoi du Retour ; le Retour est relu pour suivre le nouvel essai. */
export function useRejeu(retourId: string) {
  const apres = useApresAction(retourId);
  return useMutation({
    mutationFn: (envoiId: string) =>
      api.post<EnvoiVu>(`/api/envois/${encodeURIComponent(envoiId)}/rejeu`),
    onSettled: () => apres(),
  });
}

/**
 * Supprimer un Retour et sa Capture (demande d'effacement). `quitter` emmène hors de
 * l'écran du Retour avant qu'il quitte le cache (sinon l'écran le relirait : 404) ;
 * la boîte de réception et les badges sont relus.
 */
export function useSuppressionRetour(id: string, quitter: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(cheminRetour(id)),
    onSuccess: () => {
      quitter();
      client.removeQueries({ queryKey: cleRetour(id) });
      void client.invalidateQueries({ queryKey: CLE_LISTES });
      void client.invalidateQueries({ queryKey: CLE_ALERTES });
    },
  });
}
