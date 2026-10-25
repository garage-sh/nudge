import type { CreatedInvitation, InvitationView } from '@nudge/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client.js';

export const useInvitation = (token: string) =>
  useQuery({
    queryKey: ['invitations', token],
    queryFn: () => api.get<InvitationView>(`/api/invitations/${encodeURIComponent(token)}`),
  });

export const useCreateInvitation = () =>
  useMutation({ mutationFn: () => api.post<CreatedInvitation>('/api/invitations') });

/** The link the Member sends to the invited person. */
export const invitationUrl = (token: string): string =>
  `${window.location.origin}/invitation/${encodeURIComponent(token)}`;
