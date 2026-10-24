import type { JugeInstance, JugeInstanceVu } from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const CLE_JUGE = ['instance', 'juge'] as const;
const CHEMIN_JUGE = '/api/instance/juge';

export const useJugeInstance = () =>
  useQuery({ queryKey: CLE_JUGE, queryFn: () => api.get<JugeInstanceVu>(CHEMIN_JUGE) });

export function useChoixJuge() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (choix: JugeInstance) => api.put<JugeInstanceVu>(CHEMIN_JUGE, choix),
    onSuccess: (juge) => client.setQueryData(CLE_JUGE, juge),
  });
}
