import type {
  SignInCredentials,
  SetupState,
  MemberView,
  NewMember,
  SessionView,
} from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isSessionLost } from './client.js';

export const SESSION_KEY = ['session'] as const;
const SETUP_KEY = ['setup'] as const;

/** The signed-in Member, `null` without a session; `undefined` during the first load. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<MemberView | null> => {
      try {
        return (await api.get<SessionView>('/api/session')).member;
      } catch (error) {
        if (isSessionLost(error)) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

export function useSetupState(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: SETUP_KEY,
    queryFn: () => api.get<SetupState>('/api/setup'),
    enabled: options.enabled ?? true,
  });
}

/** A mutation that opens a session (setup, sign in, invitation) and caches it. */
function useOpenSession<V>(call: (variables: V) => Promise<SessionView>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: ({ member }) => {
      client.setQueryData(SESSION_KEY, member);
      client.setQueryData(SETUP_KEY, { required: false } satisfies SetupState);
    },
  });
}

export const useSetup = () =>
  useOpenSession((member: NewMember) => api.post<SessionView>('/api/setup', member));

export const useSignIn = () =>
  useOpenSession((credentials: SignInCredentials) =>
    api.post<SessionView>('/api/session', credentials),
  );

export const useAcceptInvitation = (token: string) =>
  useOpenSession((member: NewMember) =>
    api.post<SessionView>(`/api/invitations/${encodeURIComponent(token)}/accept`, member),
  );

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<null>('/api/session'),
    onSuccess: () => {
      client.setQueryData(SESSION_KEY, null);
      // Nothing read under this session may stay in memory.
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
    },
  });
}
