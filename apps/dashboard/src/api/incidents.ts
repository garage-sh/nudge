import type { IncidentDetailView, IncidentPage } from '@nudge/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** A Project's Incident filters, in the order they are written in the URL. */
export const INCIDENT_FILTERS = ['state', 'level', 'environment'] as const;
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

export const useIncident = (id: string) =>
  useQuery({
    queryKey: ['incidents', 'detail', id],
    queryFn: () => api.get<IncidentDetailView>(`/api/incidents/${encodeURIComponent(id)}`),
    refetchInterval: REFRESH_MS,
  });
