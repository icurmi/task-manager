import type { Match, Player, PlayingInterval, Selection, Team } from './types';

export interface PlayerMatchLine {
  playerId: string;
  started: boolean;
  ms: number;
  pct: number;
}

export function matchLines(
  match: Match,
  selections: Selection[],
  intervals: PlayingInterval[],
): PlayerMatchLine[] {
  const dur = match.durationMs ?? 0;
  return selections.map((sel) => {
    const ms = intervals
      .filter((i) => i.playerId === sel.playerId && !i.deleted)
      .reduce((t, i) => t + Math.max(0, i.offMs - i.onMs), 0);
    return {
      playerId: sel.playerId,
      started: sel.starting,
      ms,
      pct: dur > 0 ? ms / dur : 0,
    };
  });
}

export interface ReportRow {
  playerId: string;
  player: string;
  team: string;
  calledUp: number;
  starts: number;
  appearances: number;
  minutes: number;
  availableMinutes: number;
  pctPlayed: number; // 0..1
}

export interface ReportInput {
  matches: Match[];
  selections: Selection[];
  intervals: PlayingInterval[];
  players: Player[];
  teams: Team[];
}

/**
 * Aggregate finished matches into one row per player.
 * Available minutes = full length of every match the player was called up for.
 */
export function buildReport(input: ReportInput, playerFilter?: string): ReportRow[] {
  const players = new Map(input.players.map((p) => [p.id, p]));
  const teams = new Map(input.teams.map((t) => [t.id, t]));
  const finished = new Map(
    input.matches.filter((m) => m.status === 'finished' && !m.deleted).map((m) => [m.id, m]),
  );
  const msByMatchPlayer = new Map<string, number>();
  for (const iv of input.intervals) {
    if (iv.deleted || !finished.has(iv.matchId)) continue;
    const k = `${iv.matchId}|${iv.playerId}`;
    msByMatchPlayer.set(k, (msByMatchPlayer.get(k) ?? 0) + Math.max(0, iv.offMs - iv.onMs));
  }

  const acc = new Map<string, { calledUp: number; starts: number; apps: number; ms: number; avail: number; teamIds: Set<string> }>();
  for (const sel of input.selections) {
    if (sel.deleted) continue;
    const m = finished.get(sel.matchId);
    if (!m) continue;
    if (playerFilter && sel.playerId !== playerFilter) continue;
    const a =
      acc.get(sel.playerId) ??
      { calledUp: 0, starts: 0, apps: 0, ms: 0, avail: 0, teamIds: new Set<string>() };
    const ms = msByMatchPlayer.get(`${m.id}|${sel.playerId}`) ?? 0;
    a.calledUp += 1;
    if (sel.starting) a.starts += 1;
    if (ms > 0) a.apps += 1;
    a.ms += ms;
    a.avail += m.durationMs ?? 0;
    a.teamIds.add(m.teamId);
    acc.set(sel.playerId, a);
  }

  const rows: ReportRow[] = [];
  for (const [pid, a] of acc) {
    const p = players.get(pid);
    rows.push({
      playerId: pid,
      player: p ? `${p.firstName} ${p.lastName}` : 'Unknown player',
      team: [...a.teamIds].map((t) => teams.get(t)?.name ?? '?').join(', '),
      calledUp: a.calledUp,
      starts: a.starts,
      appearances: a.apps,
      minutes: Math.round(a.ms / 60000),
      availableMinutes: Math.round(a.avail / 60000),
      pctPlayed: a.avail > 0 ? a.ms / a.avail : 0,
    });
  }
  rows.sort((x, y) => x.team.localeCompare(y.team) || y.minutes - x.minutes || x.player.localeCompare(y.player));
  return rows;
}
