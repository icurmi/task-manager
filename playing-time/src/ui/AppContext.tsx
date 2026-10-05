import { createContext, useContext } from 'react';
import type { Club, Membership, Team, UserProfile } from '../domain/types';

export interface AppCtx {
  user: UserProfile;
  membership: Membership;
  club: Club;
  /** Teams this user may see, already filtered by role. */
  teams: Team[];
  signOut: () => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside provider');
  return c;
}
