// Pure, deterministic match engine. State is *derived* from the event log,
// so nothing depends on a timer having kept ticking.

import type { MatchEvent, SportConfig } from './types';

export type Phase = 'pre' | 'running' | 'break' | 'ended';

export interface OpenInterval {
  playerId: string;
  onMs: number;
  offMs: number | null;
}

export interface DerivedPeriod {
  number: number;
  startedAt: number;
  endedAt: number | null;
  clockStartMs: number;
  clockEndMs: number | null;
}

export interface MatchState {
  phase: Phase;
  /** Number of the current period (running) or the last finished one (break). 0 before kick-off. */
  period: number;
  /** Match-clock ms accumulated by finished periods. */
  bankedMs: number;
  /** Wall-clock time the current period started, if running. */
  runningSince: number | null;
  onField: string[];
  bench: string[];
  /** Players who have been substituted off at least once. */
  subbedOff: Set<string>;
  /** Who was on the field at kick-off (pre-match swaps can change the planned line-up). */
  startedIds: string[];
  intervals: OpenInterval[];
  periods: DerivedPeriod[];
}

export type Action =
  | { type: 'start' }
  | { type: 'period' }
  | { type: 'sub'; offId: string; onId: string }
  | { type: 'end' };

export function clockAt(state: MatchState, now: number): number {
  return state.bankedMs + (state.runningSince != null ? Math.max(0, now - state.runningSince) : 0);
}

export function initialState(starters: string[], bench: string[]): MatchState {
  return {
    phase: 'pre',
    period: 0,
    bankedMs: 0,
    runningSince: null,
    onField: [...starters],
    bench: [...bench],
    subbedOff: new Set(),
    startedIds: [],
    intervals: [],
    periods: [],
  };
}

/** Why an action can't be applied right now, or null if it can. */
export function rejectReason(
  state: MatchState,
  action: Action,
  config: SportConfig,
): string | null {
  switch (action.type) {
    case 'start':
      if (state.phase === 'running') return 'Clock is already running';
      if (state.phase === 'ended') return 'Match has ended';
      return null;
    case 'period':
      return state.phase === 'running' ? null : 'Clock is not running';
    case 'end':
      return state.phase === 'ended' ? 'Match has already ended' : null;
    case 'sub':
      if (state.phase === 'ended') return 'Match has ended';
      if (!state.onField.includes(action.offId)) return 'Player is not on the field';
      if (!state.bench.includes(action.onId)) return 'Player is not on the bench';
      if (!config.substitutedCanReturn && state.subbedOff.has(action.onId))
        return 'Substituted players cannot return';
      return null;
  }
}

function openFor(state: MatchState, playerId: string, clock: number) {
  state.intervals.push({ playerId, onMs: clock, offMs: null });
}

function closeFor(state: MatchState, playerId: string, clock: number) {
  for (let i = state.intervals.length - 1; i >= 0; i--) {
    const iv = state.intervals[i];
    if (iv.playerId === playerId && iv.offMs == null) {
      iv.offMs = clock;
      return;
    }
  }
}

/** Apply one event (mutates a cloned state). Invalid events are ignored, keeping replay robust. */
export function applyEvent(
  prev: MatchState,
  ev: Pick<MatchEvent, 'type' | 'at' | 'offId' | 'onId'>,
  config: SportConfig,
): MatchState {
  const action: Action =
    ev.type === 'sub' ? { type: 'sub', offId: ev.offId!, onId: ev.onId! } : { type: ev.type };
  if (rejectReason(prev, action, config)) return prev;

  const s: MatchState = {
    ...prev,
    onField: [...prev.onField],
    bench: [...prev.bench],
    subbedOff: new Set(prev.subbedOff),
    intervals: prev.intervals.map((i) => ({ ...i })),
    periods: prev.periods.map((p) => ({ ...p })),
  };
  const clock = clockAt(s, ev.at);

  switch (action.type) {
    case 'start': {
      if (s.phase === 'pre') {
        for (const id of s.onField) openFor(s, id, 0);
        s.startedIds = [...s.onField];
      }
      s.period += 1;
      s.phase = 'running';
      s.runningSince = ev.at;
      s.periods.push({
        number: s.period,
        startedAt: ev.at,
        endedAt: null,
        clockStartMs: s.bankedMs,
        clockEndMs: null,
      });
      break;
    }
    case 'period': {
      s.bankedMs = clock;
      s.runningSince = null;
      s.phase = 'break';
      const p = s.periods[s.periods.length - 1];
      p.endedAt = ev.at;
      p.clockEndMs = clock;
      break;
    }
    case 'sub': {
      const { offId, onId } = action;
      s.onField[s.onField.indexOf(offId)] = onId;
      s.bench[s.bench.indexOf(onId)] = offId;
      // Before kick-off a "sub" is just a line-up change – no intervals yet.
      if (s.phase !== 'pre') {
        s.subbedOff.add(offId);
        closeFor(s, offId, clock);
        openFor(s, onId, clock);
      }
      break;
    }
    case 'end': {
      if (s.phase === 'running') {
        const p = s.periods[s.periods.length - 1];
        p.endedAt = ev.at;
        p.clockEndMs = clock;
      }
      s.bankedMs = clock;
      s.runningSince = null;
      s.phase = 'ended';
      for (const id of s.onField) closeFor(s, id, clock);
      break;
    }
  }
  return s;
}

export function replay(
  starters: string[],
  bench: string[],
  events: Pick<MatchEvent, 'type' | 'at' | 'offId' | 'onId' | 'seq'>[],
  config: SportConfig,
): MatchState {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  return sorted.reduce((s, e) => applyEvent(s, e, config), initialState(starters, bench));
}

/** Live ms played per player at wall-clock `now`. */
export function playerMs(state: MatchState, now: number): Map<string, number> {
  const clock = clockAt(state, now);
  const out = new Map<string, number>();
  for (const iv of state.intervals) {
    const end = iv.offMs ?? clock;
    out.set(iv.playerId, (out.get(iv.playerId) ?? 0) + Math.max(0, end - iv.onMs));
  }
  return out;
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Parse "32:14", "32", or "1:02:03" into ms. Returns null if invalid. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  let secs = 0;
  if (parts.length === 1) secs = parts[0] * 60;
  else if (parts.length === 2) {
    if (parts[1] > 59) return null;
    secs = parts[0] * 60 + parts[1];
  } else {
    if (parts[1] > 59 || parts[2] > 59) return null;
    secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return secs * 1000;
}

export function minutesOf(ms: number): number {
  return Math.round(ms / 60000);
}
