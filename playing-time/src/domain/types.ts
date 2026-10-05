// Platform → Club → Teams → Coaches → Players
// Every row has an id, clubId (for tenancy / row-level security) and updatedAt (for sync).

export type Role = 'coach' | 'head_coach' | 'club_admin';

export interface SportConfig {
  /** Players on the pitch at once (11 for 11-a-side, 7, 9 …). */
  playersOnField: number;
  /** Rolling subs: may a substituted player come back on? */
  substitutedCanReturn: boolean;
}

export const DEFAULT_SPORT_CONFIG: SportConfig = {
  playersOnField: 11,
  substitutedCanReturn: true,
};

interface Row {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

export interface Club extends Row {
  name: string;
  /** Short name used in the match header, e.g. "MELITA". */
  shortName: string;
  country: string;
  season: string;
  sportConfig: SportConfig;
}

export interface Team extends Row {
  clubId: string;
  name: string; // "U14"
  ageGroup: string; // "U14"
  /** Optional per-team override (e.g. 7-a-side for U10). Hidden from coaches. */
  sportConfig?: SportConfig;
}

export interface Player extends Row {
  clubId: string;
  teamId: string;
  firstName: string;
  lastName: string;
  shirtNumber: number | null;
  active: boolean;
}

export interface UserProfile extends Row {
  email: string;
  name: string;
}

export interface Membership extends Row {
  clubId: string;
  userId: string;
  role: Role;
  /** coach / head_coach: explicit team access. */
  teamIds: string[];
  /** head_coach / coordinator: access by age group, e.g. ["U12","U13","U14"]. */
  ageGroups: string[];
}

export interface Invitation extends Row {
  clubId: string;
  email: string;
  role: Role;
  teamIds: string[];
  ageGroups: string[];
  invitedBy: string;
  acceptedAt?: number;
}

export type MatchStatus = 'live' | 'finished';

export interface Match extends Row {
  clubId: string;
  teamId: string;
  opponent: string;
  createdBy: string;
  createdAt: number;
  status: MatchStatus;
  sportConfig: SportConfig;
  /** Wall-clock time of first kick-off (set by START). */
  kickoffAt?: number;
  endedAt?: number;
  /** Total match-clock time in ms (sum of all periods). Set at END GAME, recomputed after corrections. */
  durationMs?: number;
}

/** A player called up for this match only. */
export interface Selection extends Row {
  clubId: string;
  matchId: string;
  playerId: string;
  starting: boolean;
}

/**
 * The event log is the source of truth while a match is live.
 * `at` is a wall-clock epoch-ms timestamp – never a running counter – so the
 * clock survives the app being killed, the phone locking or a reload.
 */
export type MatchEventType = 'start' | 'period' | 'sub' | 'end';

export interface MatchEvent extends Row {
  clubId: string;
  matchId: string;
  seq: number;
  type: MatchEventType;
  at: number;
  offId?: string;
  onId?: string;
  /** Where the action came from: app, lock screen, media keys… */
  source?: string;
}

export interface Period extends Row {
  clubId: string;
  matchId: string;
  number: number;
  startedAt: number;
  endedAt: number;
  /** Match-clock offsets (ms) at start / end of the period. */
  clockStartMs: number;
  clockEndMs: number;
}

/** One ON→OFF stretch for a player, in match-clock ms. e.g. ON 00:00 OFF 32:14. */
export interface PlayingInterval extends Row {
  clubId: string;
  matchId: string;
  playerId: string;
  onMs: number;
  offMs: number;
}

export interface AuditEntry extends Row {
  clubId: string;
  matchId: string;
  userId: string;
  userName: string;
  at: number;
  playerId: string;
  action: 'add' | 'edit' | 'delete';
  before?: { onMs: number; offMs: number };
  after?: { onMs: number; offMs: number };
}

export interface OutboxItem {
  seq?: number;
  table: string;
  rowId: string;
  queuedAt: number;
}
