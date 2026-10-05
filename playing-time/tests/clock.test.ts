import { describe, expect, it } from 'vitest';
import { applyEvent, clockAt, fmtClock, initialState, parseClock, playerMs, rejectReason, replay } from '../src/domain/clock';
import { DEFAULT_SPORT_CONFIG } from '../src/domain/types';

const cfg = DEFAULT_SPORT_CONFIG;
const MIN = 60_000;
const T0 = 1_700_000_000_000;

function ev(seq: number, type: 'start' | 'period' | 'sub' | 'end', atMin: number, offId?: string, onId?: string) {
  return { seq, type, at: T0 + atMin * MIN, offId, onId };
}

describe('match clock', () => {
  it('only counts while running, across periods and breaks', () => {
    const s = replay(['a', 'b'], ['c'], [ev(1, 'start', 0), ev(2, 'period', 35), ev(3, 'start', 45)], cfg);
    expect(s.phase).toBe('running');
    expect(s.period).toBe(2);
    // 10 minutes of half-time are not counted
    expect(clockAt(s, T0 + 50 * MIN)).toBe(40 * MIN);
  });

  it('is derived from timestamps, so a reload mid-match gives the same clock', () => {
    const events = [ev(1, 'start', 0)];
    const a = replay(['a'], [], events, cfg);
    const b = replay(['a'], [], events, cfg); // "after reload"
    expect(clockAt(a, T0 + 12 * MIN)).toBe(clockAt(b, T0 + 12 * MIN));
  });

  it('records intervals exactly like the audit trail example', () => {
    const s = replay(
      ['a', 'b'],
      ['c'],
      [
        ev(1, 'start', 0),
        { seq: 2, type: 'sub' as const, at: T0 + 32 * MIN + 14_000, offId: 'a', onId: 'c' },
        ev(3, 'period', 35),
        ev(4, 'start', 45),
        { seq: 5, type: 'sub' as const, at: T0 + 58 * MIN + 3_000, offId: 'c', onId: 'a' },
        ev(6, 'period', 80),
        ev(7, 'end', 85),
      ],
      cfg,
    );
    const a = s.intervals.filter((i) => i.playerId === 'a').map((i) => [fmtClock(i.onMs), fmtClock(i.offMs!)]);
    expect(a).toEqual([
      ['00:00', '32:14'],
      ['48:03', '70:00'],
    ]);
    expect(s.phase).toBe('ended');
    expect(s.bankedMs).toBe(70 * MIN);
    const ms = playerMs(s, T0 + 999 * MIN);
    expect(ms.get('b')).toBe(70 * MIN);
    expect(ms.get('a')! + ms.get('c')!).toBe(70 * MIN);
  });

  it('pre-match swaps change the line-up without creating intervals', () => {
    let s = initialState(['a'], ['b']);
    s = applyEvent(s, ev(1, 'sub', 0, 'a', 'b'), cfg);
    expect(s.onField).toEqual(['b']);
    expect(s.intervals).toHaveLength(0);
    expect(s.subbedOff.size).toBe(0);
    s = applyEvent(s, ev(2, 'start', 1), cfg);
    expect(s.startedIds).toEqual(['b']);
  });

  it('enforces no-return when configured', () => {
    const noReturn = { ...cfg, substitutedCanReturn: false };
    let s = replay(['a'], ['b'], [ev(1, 'start', 0), ev(2, 'sub', 10, 'a', 'b')], noReturn);
    expect(rejectReason(s, { type: 'sub', offId: 'b', onId: 'a' }, noReturn)).toMatch(/cannot return/);
    s = applyEvent(s, ev(3, 'sub', 11, 'b', 'a'), noReturn);
    expect(s.onField).toEqual(['b']);
  });

  it('ignores invalid events (double START from lock screen + app)', () => {
    const s = replay(['a'], [], [ev(1, 'start', 0), ev(2, 'start', 0.1)], cfg);
    expect(s.period).toBe(1);
  });

  it('END GAME while running closes the last period', () => {
    const s = replay(['a'], [], [ev(1, 'start', 0), ev(2, 'end', 20)], cfg);
    expect(s.periods[0].clockEndMs).toBe(20 * MIN);
    expect(s.intervals[0].offMs).toBe(20 * MIN);
  });

  it('parses clock text', () => {
    expect(parseClock('32:14')).toBe(32 * MIN + 14_000);
    expect(parseClock('70')).toBe(70 * MIN);
    expect(parseClock('3:75')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });
});
