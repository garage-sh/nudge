import type {
  DestinationWithGeneratedSecrets,
  DestinationView,
  DestinationUpdate,
  NewDestination,
  DestinationTestResult,
} from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { PROJECTS_ACTIVITY_KEY } from './projects.js';

const destinationsKey = (projectId: string) => ['projects', projectId, 'destinations'] as const;
const projectDestinationsPath = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/destinations`;
const destinationPath = (id: string) => `/api/destinations/${encodeURIComponent(id)}`;

export const useDestinations = (projectId: string) =>
  useQuery({
    queryKey: destinationsKey(projectId),
    queryFn: () => api.get<DestinationView[]>(projectDestinationsPath(projectId)),
  });

/** Stores an updated Destination in the Project's list (`null`: removed). */
function useStoreDestination(projectId: string) {
  const client = useQueryClient();
  return (id: string, destination: DestinationView | null) => {
    // The Project's number of Destinations changes: its activity is read again.
    void client.invalidateQueries({ queryKey: PROJECTS_ACTIVITY_KEY });
    client.setQueryData<DestinationView[]>(destinationsKey(projectId), (list = []) => {
      const others = list.filter((d) => d.id !== id);
      if (!destination) return others;
      const index = list.findIndex((d) => d.id === id);
      return index === -1
        ? [...list, destination]
        : list.map((d) => (d.id === id ? destination : d));
    });
  };
}

export function useCreateDestination(projectId: string) {
  const store = useStoreDestination(projectId);
  return useMutation({
    mutationFn: (destination: NewDestination) =>
      api.post<DestinationWithGeneratedSecrets>(projectDestinationsPath(projectId), destination),
    onSuccess: ({ destination }) => store(destination.id, destination),
  });
}

export function useUpdateDestination(projectId: string, id: string) {
  const store = useStoreDestination(projectId);
  return useMutation({
    mutationFn: (update: DestinationUpdate) =>
      api.patch<DestinationView>(destinationPath(id), update),
    onSuccess: (destination) => store(id, destination),
  });
}

export function useDeleteDestination(projectId: string, id: string) {
  const store = useStoreDestination(projectId);
  return useMutation({
    mutationFn: () => api.delete<null>(destinationPath(id)),
    onSuccess: () => store(id, null),
  });
}

export function useRegenerateGeneratedSecrets(projectId: string, id: string) {
  const store = useStoreDestination(projectId);
  return useMutation({
    mutationFn: () =>
      api.post<DestinationWithGeneratedSecrets>(`${destinationPath(id)}/generated-secrets`),
    onSuccess: ({ destination }) => store(id, destination),
  });
}

/** Sends a sample Feedback; the result (delivered or failed) is a 200 response. */
export const useTestDestination = (id: string) =>
  useMutation({
    mutationFn: () => api.post<DestinationTestResult>(`${destinationPath(id)}/test`),
  });
