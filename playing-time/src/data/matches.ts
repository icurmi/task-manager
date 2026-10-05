import { replay, type MatchState } from '../domain/clock';
import type {
  AuditEntry, Match, MatchEvent, Period, PlayingInterval, Selection, SportConfig,
} from '../domain/types';
import { db, put, uid } from './db';
import { practiceStore } from './practice';

export interface MatchBundle {
  match: Match;
  selections: Selection[];
  events: MatchEvent[];
}

export interface NewMatchInput {
  clubId: string;
  teamId: string;
  opponent: string;
  createdBy: string;
  sportConfig: SportConfig;
  lineup: { playerId: string; starting: boolean }[];
  practice: boolean;
}

export async function createMatch(input: NewMatchInput): Promise<string> {
  const now = Date.now();
  const match: Match = {
    id: uid(), updatedAt: now, clubId: input.clubId, teamId: input.teamId,
    opponent: input.opponent.trim(), createdBy: input.createdBy, createdAt: now,
    status: 'live', sportConfig: input.sportConfig,
  };
  const selections: Selection[] = input.lineup.map((l) => ({
    id: uid(), updatedAt: now, clubId: input.clubId, matchId: match.id,
    playerId: l.playerId, starting: l.starting,
  }));
  if (input.practice) {
    practiceStore.set({ match, selections, events: [] });
    return match.id;
  }
  await put('matches', match);
  await put('selections', selections);
  return match.id;
}

export async function loadBundle(matchId: string): Promise<MatchBundle | undefined> {
  const p = practiceStore.get();
  if (p && p.match.id === matchId) return p;
  const match = await db.matches.get(matchId);
  if (!match) return undefined;
  const [selections, events] = await Promise.all([
    db.selections.where('matchId').equals(matchId).filter((s) => !s.deleted).toArray(),
    db.events.where('matchId').equals(matchId).filter((e) => !e.deleted).toArray(),
  ]);
  events.sort((a, b) => a.seq - b.seq);
  return { match, selections, events };
}

export function isPractice(matchId: string) {
  return practiceStore.get()?.match.id === matchId;
}

export function stateOf(b: MatchBundle): MatchState {
  const starters = b.selections.filter((s) => s.starting).map((s) => s.playerId);
  const bench = b.selections.filter((s) => !s.starting).map((s) => s.playerId);
  return replay(starters, bench, b.events, b.match.sportConfig);
}

export async function appendEvent(
  b: MatchBundle,
  e: Pick<MatchEvent, 'type' | 'at' | 'offId' | 'onId' | 'source'>,
): Promise<MatchBundle> {
  const seq = (b.events.at(-1)?.seq ?? 0) + 1;
  const ev: MatchEvent = { id: uid(), updatedAt: Date.now(), clubId: b.match.clubId, matchId: b.match.id, seq, ...e };
  const next = { ...b, events: [...b.events, ev] };
  if (isPractice(b.match.id)) practiceStore.set(next);
  else await put('events', ev);
  return next;
}

/** Undo = soft-delete the last event. The audit trail on the server keeps it. */
export async function undoLast(b: MatchBundle): Promise<MatchBundle> {
  const last = b.events.at(-1);
  if (!last || last.type === 'end') return b;
  const next = { ...b, events: b.events.slice(0, -1) };
  if (isPractice(b.match.id)) practiceStore.set(next);
  else await put('events', { ...last, deleted: true });
  return next;
}

/** END GAME: append the end event and materialise Periods + Playing Intervals. */
export async function finishMatch(b: MatchBundle, at: number): Promise<MatchBundle> {
  const withEnd = await appendEvent(b, { type: 'end', at, source: 'app' });
  const s = stateOf(withEnd);
  const match: Match = {
    ...withEnd.match, status: 'finished', endedAt: at, durationMs: s.bankedMs,
    kickoffAt: s.periods[0]?.startedAt,
  };
  if (isPractice(b.match.id)) {
    practiceStore.set({ ...withEnd, match });
    return { ...withEnd, match };
  }
  const now = Date.now();
  const periods: Period[] = s.periods.map((p) => ({
    id: uid(), updatedAt: now, clubId: match.clubId, matchId: match.id, number: p.number,
    startedAt: p.startedAt, endedAt: p.endedAt ?? at, clockStartMs: p.clockStartMs,
    clockEndMs: p.clockEndMs ?? s.bankedMs,
  }));
  const intervals: PlayingInterval[] = s.intervals
    .filter((iv) => (iv.offMs ?? s.bankedMs) > iv.onMs)
    .map((iv) => ({
      id: uid(), updatedAt: now, clubId: match.clubId, matchId: match.id, playerId: iv.playerId,
      onMs: iv.onMs, offMs: iv.offMs ?? s.bankedMs,
    }));
  // "Started" reflects who actually kicked off (line-up may have been swapped pre-match).
  const started = new Set(s.startedIds);
  const selections = withEnd.selections.map((sel) => ({ ...sel, starting: started.has(sel.playerId) }));
  await put('matches', match);
  await put('periods', periods);
  await put('intervals', intervals);
  await put('selections', selections);
  return { ...withEnd, match, selections };
}

export async function intervalsOf(matchId: string) {
  return (await db.intervals.where('matchId').equals(matchId).toArray())
    .filter((i) => !i.deleted)
    .sort((a, b) => a.onMs - b.onMs);
}

export async function periodsOf(matchId: string) {
  return (await db.periods.where('matchId').equals(matchId).toArray())
    .filter((p) => !p.deleted)
    .sort((a, b) => a.number - b.number);
}

export async function auditOf(matchId: string) {
  return (await db.audit.where('matchId').equals(matchId).toArray()).sort((a, b) => b.at - a.at);
}

export interface Editor { id: string; name: string }

/** Post-match correction of a single interval, with an audit entry. */
export async function correctInterval(
  match: Match,
  editor: Editor,
  change:
    | { action: 'add'; playerId: string; onMs: number; offMs: number }
    | { action: 'edit'; interval: PlayingInterval; onMs: number; offMs: number }
    | { action: 'delete'; interval: PlayingInterval },
) {
  const now = Date.now();
  const base = { id: uid(), updatedAt: now, clubId: match.clubId, matchId: match.id, userId: editor.id, userName: editor.name, at: now };
  let entry: AuditEntry;
  if (change.action === 'add') {
    await put('intervals', {
      id: uid(), updatedAt: now, clubId: match.clubId, matchId: match.id,
      playerId: change.playerId, onMs: change.onMs, offMs: change.offMs,
    });
    entry = { ...base, playerId: change.playerId, action: 'add', after: { onMs: change.onMs, offMs: change.offMs } };
  } else if (change.action === 'edit') {
    const iv = change.interval;
    await put('intervals', { ...iv, onMs: change.onMs, offMs: change.offMs });
    entry = { ...base, playerId: iv.playerId, action: 'edit', before: { onMs: iv.onMs, offMs: iv.offMs }, after: { onMs: change.onMs, offMs: change.offMs } };
  } else {
    const iv = change.interval;
    await put('intervals', { ...iv, deleted: true });
    entry = { ...base, playerId: iv.playerId, action: 'delete', before: { onMs: iv.onMs, offMs: iv.offMs } };
  }
  await put('audit', entry);
}

/** Validate an interval against match length and the player's other intervals. */
export function validateInterval(
  onMs: number, offMs: number, durationMs: number, others: PlayingInterval[],
): string | null {
  if (onMs >= offMs) return 'ON must be before OFF';
  if (offMs > durationMs) return 'OFF is after the end of the match';
  if (others.some((o) => onMs < o.offMs && offMs > o.onMs)) return 'Overlaps another interval';
  return null;
}

export async function updateMatchDuration(match: Match, durationMs: number) {
  await put('matches', { ...match, durationMs });
}

export async function liveMatchFor(teamIds: string[]): Promise<Match | undefined> {
  const p = practiceStore.get();
  if (p && p.match.status === 'live' && teamIds.includes(p.match.teamId)) return p.match;
  return (await db.matches.where('status').equals('live').toArray())
    .filter((m) => !m.deleted && teamIds.includes(m.teamId))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export async function discardMatch(matchId: string) {
  if (isPractice(matchId)) {
    practiceStore.clear();
    return;
  }
  const m = await db.matches.get(matchId);
  if (m) await put('matches', { ...m, deleted: true });
}
