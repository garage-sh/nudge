import type { AlertesVu } from '@nudge/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** Relue régulièrement : un Retour passe En revue, une Destination est Suspendue, sans action du Membre. */
const INTERVALLE_MS = 30_000;

export const CLE_ALERTES = ['alertes'] as const;

export const useAlertes = () =>
  useQuery({
    queryKey: CLE_ALERTES,
    queryFn: () => api.get<AlertesVu>('/api/alertes'),
    refetchInterval: INTERVALLE_MS,
  });
