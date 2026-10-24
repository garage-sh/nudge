import type { MembreListeVu } from '@nudge/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** Les Membres de l'Instance, du plus ancien au plus récent. */
export const useMembres = () =>
  useQuery({ queryKey: ['membres'], queryFn: () => api.get<MembreListeVu[]>('/api/membres') });
