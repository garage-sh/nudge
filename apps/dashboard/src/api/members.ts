import type { MemberListItemView } from '@nudge/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** The Instance's Members, from oldest to newest. */
export const useMembers = () =>
  useQuery({ queryKey: ['members'], queryFn: () => api.get<MemberListItemView[]>('/api/members') });
