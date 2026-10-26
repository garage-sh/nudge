import type { MemberListItemView } from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const MEMBERS_KEY = ['members'] as const;

/** The Instance's Members, from oldest to newest. */
export const useMembers = () =>
  useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: () => api.get<MemberListItemView[]>('/api/members'),
  });

/** Removes another Member: their sessions end at once. */
export function useRemoveMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (member: MemberListItemView) =>
      api.delete<null>(`/api/members/${encodeURIComponent(member.id)}`),
    onSettled: () => client.invalidateQueries({ queryKey: MEMBERS_KEY }),
  });
}
