import type { InvitationCreee, InvitationVue } from '@nudge/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client.js';

export const useInvitation = (jeton: string) =>
  useQuery({
    queryKey: ['invitations', jeton],
    queryFn: () => api.get<InvitationVue>(`/api/invitations/${encodeURIComponent(jeton)}`),
  });

export const useCreationInvitation = () =>
  useMutation({ mutationFn: () => api.post<InvitationCreee>('/api/invitations') });

/** Le lien que le Membre transmet à la personne invitée. */
export const lienInvitation = (jeton: string): string =>
  `${window.location.origin}/invitation/${encodeURIComponent(jeton)}`;
