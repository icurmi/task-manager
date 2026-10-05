import type { Membership, Team } from './types';

export function visibleTeams(m: Membership | undefined, teams: Team[]): Team[] {
  if (!m) return [];
  const live = teams.filter((t) => !t.deleted && t.clubId === m.clubId);
  if (m.role === 'club_admin') return live;
  return live.filter((t) => m.teamIds.includes(t.id) || m.ageGroups.includes(t.ageGroup));
}

/** Club Admins manage the club but have no part in running matches. */
export function canRunMatches(m: Membership | undefined): boolean {
  return !!m && m.role !== 'club_admin';
}

export function canManageClub(m: Membership | undefined): boolean {
  return m?.role === 'club_admin';
}

export function canCorrectMatch(m: Membership | undefined, teams: Team[], teamId: string): boolean {
  if (!m) return false;
  return visibleTeams(m, teams).some((t) => t.id === teamId);
}

export type ReportScope = 'match' | 'player' | 'team' | 'range' | 'club';

export function reportScopes(m: Membership | undefined): ReportScope[] {
  if (!m) return [];
  if (m.role === 'club_admin') return ['club', 'team', 'range', 'player', 'match'];
  return ['team', 'range', 'player', 'match'];
}

export const ROLE_LABEL: Record<Membership['role'], string> = {
  coach: 'Coach',
  head_coach: 'Head Coach / Coordinator',
  club_admin: 'Club Admin',
};
