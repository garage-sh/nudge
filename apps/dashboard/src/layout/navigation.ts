import { Inbox, Settings, Users, type LucideIcon } from 'lucide-react';
import type { Messages } from '../i18n/index.js';

/**
 * The sidebar's entries, in order. `MAIN_NAVIGATION` opens the sidebar (daily work),
 * `INSTANCE_NAVIGATION` closes it (administration). Projects go between the two, read
 * from the API. A new top-level screen is added here and in `routes.tsx`.
 */
export interface NavigationEntry {
  readonly path: string;
  readonly label: keyof Messages['layout'];
  readonly icon: LucideIcon;
}

export const MAIN_NAVIGATION: readonly NavigationEntry[] = [
  { path: '/feedbacks', label: 'inbox', icon: Inbox },
];

export const INSTANCE_NAVIGATION: readonly NavigationEntry[] = [
  { path: '/members', label: 'members', icon: Users },
  { path: '/settings', label: 'settings', icon: Settings },
];
