import type {
  ChoixJuge,
  DestinationAlerteAvecSecretsGeneres,
  DestinationAlerteSaisie,
  DestinationAlerteVu,
  JugeInstanceVu,
  ResultatTestDestination,
  RetentionVu,
} from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const CLE_JUGE = ['instance', 'juge'] as const;
const CHEMIN_JUGE = '/api/instance/juge';

export const useJugeInstance = () =>
  useQuery({ queryKey: CLE_JUGE, queryFn: () => api.get<JugeInstanceVu>(CHEMIN_JUGE) });

export function useChoixJuge() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (choix: ChoixJuge) => api.put<JugeInstanceVu>(CHEMIN_JUGE, choix),
    onSuccess: (juge) => client.setQueryData(CLE_JUGE, juge),
  });
}

const CLE_ALERTE = ['instance', 'alerte'] as const;
const CHEMIN_ALERTE = '/api/instance/alerte';

export const useDestinationAlerte = () =>
  useQuery({
    queryKey: CLE_ALERTE,
    queryFn: () => api.get<{ destination: DestinationAlerteVu | null }>(CHEMIN_ALERTE),
  });

export function useConfigurationAlerte() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (saisie: DestinationAlerteSaisie) =>
      api.put<DestinationAlerteAvecSecretsGeneres>(CHEMIN_ALERTE, saisie),
    onSuccess: ({ destination }) => client.setQueryData(CLE_ALERTE, { destination }),
  });
}

export function useRetraitAlerte() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(CHEMIN_ALERTE),
    onSuccess: () => client.setQueryData(CLE_ALERTE, { destination: null }),
  });
}

export const useTestAlerte = () =>
  useMutation({
    mutationFn: () => api.post<ResultatTestDestination>(`${CHEMIN_ALERTE}/test`),
  });

const CLE_RETENTION = ['instance', 'retention'] as const;
const CHEMIN_RETENTION = '/api/instance/retention';

export const useRetention = () =>
  useQuery({ queryKey: CLE_RETENTION, queryFn: () => api.get<RetentionVu>(CHEMIN_RETENTION) });

export function useChangementRetention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (retention: RetentionVu) => api.put<RetentionVu>(CHEMIN_RETENTION, retention),
    onSuccess: (retention) => client.setQueryData(CLE_RETENTION, retention),
  });
}
