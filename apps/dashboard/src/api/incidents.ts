import type {
  DeliveryView,
  IncidentDetailView,
  IncidentPage,
  IncidentRedispatchView,
} from '@nudge/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

/** A Project's Incident filters, in the order they are written in the URL. */
export const INCIDENT_FILTERS = ['state', 'level', 'environment', 'held'] as const;
export type IncidentFilterName = (typeof INCIDENT_FILTERS)[number];
/** Values read as is from the URL: the api validates them (400 otherwise). */
export type IncidentFilters = Partial<Record<IncidentFilterName, string>>;

/**
 * Incidents move with no action from the Member (Occurrences keep arriving during an
 * outage): the list and the detail are read again on this interval.
 */
const REFRESH_MS = 15_000;

function incidentsPath(projectId: string, filters: IncidentFilters, cursor: string | null) {
  const params = new URLSearchParams({ project: projectId });
  for (const name of INCIDENT_FILTERS) {
    const value = filters[name];
    if (value) params.set(name, value);
  }
  if (cursor) params.set('cursor', cursor);
  return `/api/incidents?${params.toString()}`;
}

/** A Project's Incidents, page by page (newest opened first). */
export const useIncidents = (projectId: string, filters: IncidentFilters) =>
  useInfiniteQuery({
    queryKey: ['incidents', 'list', projectId, filters],
    queryFn: ({ pageParam }) => api.get<IncidentPage>(incidentsPath(projectId, filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
    refetchInterval: REFRESH_MS,
  });

/** The Environments a Project's Incidents were opened in: the choices of the filter. */
export const useIncidentEnvironments = (projectId: string) =>
  useQuery({
    queryKey: ['incidents', 'environments', projectId],
    queryFn: () =>
      api.get<string[]>(
        `/api/incidents/environments?${new URLSearchParams({ project: projectId }).toString()}`,
      ),
  });

/** After an action, while the worker sends the Deliveries: the detail is read this often. */
const POLL_MS = 1000;

const incidentKey = (id: string) => ['incidents', 'detail', id];
const incidentPath = (id: string) => `/api/incidents/${encodeURIComponent(id)}`;

/** An Incident's detail; read more often until `pollUntil` (an instant, in ms), after an action. */
export const useIncident = (id: string, { pollUntil = 0 } = {}) =>
  useQuery({
    queryKey: incidentKey(id),
    queryFn: () => api.get<IncidentDetailView>(incidentPath(id)),
    refetchInterval: () => (Date.now() < pollUntil ? POLL_MS : REFRESH_MS),
  });

/** After an action on an Incident: stores the updated Incident if returned, reads it again otherwise. */
function useAfterAction(id: string) {
  const client = useQueryClient();
  return (incident?: IncidentDetailView) => {
    if (incident) client.setQueryData(incidentKey(id), incident);
    else void client.invalidateQueries({ queryKey: incidentKey(id) });
  };
}

/** Replay one of the Incident's Deliveries; the Incident is read again to follow the new attempt. */
export function useReplayIncidentDelivery(incidentId: string) {
  const after = useAfterAction(incidentId);
  return useMutation({
    mutationFn: (deliveryId: string) =>
      api.post<DeliveryView>(`/api/deliveries/${encodeURIComponent(deliveryId)}/replay`),
    onSettled: () => after(),
  });
}

/**
 * Redispatch the Open Incident: the missing Deliveries to the Destinations whose Incident
 * Filter accepts it at its current Level; the updated Incident is stored.
 */
export function useRedispatchIncident(id: string) {
  const after = useAfterAction(id);
  return useMutation({
    mutationFn: () => api.post<IncidentRedispatchView>(`${incidentPath(id)}/redispatch`),
    onSettled: (result) => after(result?.incident),
  });
}

/** Close the Open Incident by hand; the Closed Incident is stored, and the lists read again. */
export function useCloseIncident(id: string) {
  const after = useAfterAction(id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<IncidentDetailView>(`${incidentPath(id)}/close`),
    onSettled: (incident) => {
      after(incident);
      void client.invalidateQueries({ queryKey: ['incidents', 'list'] });
    },
  });
}

/**
 * Delete the Incident and its Deliveries (Deletion). `leave` takes the Member off the
 * Incident's screen before it leaves the cache (the screen would read it again: 404);
 * the lists are read again.
 */
export function useDeleteIncident(id: string, leave: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(incidentPath(id)),
    onSuccess: () => {
      leave();
      client.removeQueries({ queryKey: incidentKey(id) });
      void client.invalidateQueries({ queryKey: ['incidents', 'list'] });
      void client.invalidateQueries({ queryKey: ['incidents', 'environments'] });
    },
  });
}
