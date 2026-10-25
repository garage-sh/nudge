import type {
  ProjectActivityView,
  ProjectUpdate,
  NewProject,
  ProjectWithSecretKey,
  ProjectView,
} from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const PROJECTS_KEY = ['projects'] as const;
const projectKey = (id: string) => ['projects', id] as const;
const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const useProjects = () =>
  useQuery({ queryKey: PROJECTS_KEY, queryFn: () => api.get<ProjectView[]>('/api/projects') });

/** Each Project's activity, read again like the alerts: it moves with no action from the Member. */
export const PROJECTS_ACTIVITY_KEY = ['projects-activity'] as const;

export const useProjectsActivity = () =>
  useQuery({
    queryKey: PROJECTS_ACTIVITY_KEY,
    queryFn: () => api.get<ProjectActivityView[]>('/api/projects/activity'),
    refetchInterval: 30_000,
    select: (rows) => new Map(rows.map((row) => [row.projectId, row])),
  });

export const useProject = (id: string) =>
  useQuery({ queryKey: projectKey(id), queryFn: () => api.get<ProjectView>(projectPath(id)) });

/** Stores an updated Project in the cache (detail) and invalidates the list. */
function useStoreProject() {
  const client = useQueryClient();
  return (project: ProjectView) => {
    client.setQueryData(projectKey(project.id), project);
    void client.invalidateQueries({ queryKey: PROJECTS_KEY, exact: true });
  };
}

export function useCreateProject() {
  const store = useStoreProject();
  return useMutation({
    mutationFn: (project: NewProject) => api.post<ProjectWithSecretKey>('/api/projects', project),
    onSuccess: ({ project }) => store(project),
  });
}

export function useUpdateProject(id: string) {
  const store = useStoreProject();
  return useMutation({
    mutationFn: (update: ProjectUpdate) => api.patch<ProjectView>(projectPath(id), update),
    onSuccess: store,
  });
}

export function useRegeneratePublicKey(id: string) {
  const store = useStoreProject();
  return useMutation({
    mutationFn: () => api.post<ProjectView>(`${projectPath(id)}/public-key`),
    onSuccess: store,
  });
}

export function useRegenerateSecretKey(id: string) {
  const store = useStoreProject();
  return useMutation({
    mutationFn: () => api.post<ProjectWithSecretKey>(`${projectPath(id)}/secret-key`),
    onSuccess: ({ project }) => store(project),
  });
}
