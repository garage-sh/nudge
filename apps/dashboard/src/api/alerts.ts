import type { AlertsView } from '@nudge/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** Read regularly: a Feedback goes In review, a Destination is Suspended, with no action from the Member. */
const INTERVAL_MS = 30_000;

export const ALERTS_KEY = ['alerts'] as const;

export const useAlerts = () =>
  useQuery({
    queryKey: ALERTS_KEY,
    queryFn: () => api.get<AlertsView>('/api/alerts'),
    refetchInterval: INTERVAL_MS,
  });
