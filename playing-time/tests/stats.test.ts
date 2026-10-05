import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/domain/stats';
import { seedData } from '../src/data/seed';
import { fromServer, toServer } from '../src/data/sync';

describe('reports', () => {
  const { players, teams, history } = seedData(0);
  const input = {
    matches: history.map((h) => h.match),
    selections: history.flatMap((h) => h.selections),
    intervals: history.flatMap((h) => h.intervals),
    players,
    teams,
  };

  it('seed has Melita FC U14 with 18 players and two finished matches', () => {
    expect(players.filter((p) => p.teamId === 'team-melita-u14')).toHaveLength(18);
    expect(input.matches.every((m) => m.status === 'finished')).toBe(true);
  });

  it('aggregates called up / starts / appearances / minutes / available / %', () => {
    const rows = buildReport(input);
    const borg = rows.find((r) => r.player === 'Luke Borg')!;
    expect(borg).toMatchObject({ team: 'U14', calledUp: 2, starts: 2, appearances: 2 });
    expect(borg.minutes).toBe(borg.availableMinutes);
    expect(borg.pctPlayed).toBeCloseTo(1);
    // every row: minutes never exceed available
    for (const r of rows) expect(r.minutes).toBeLessThanOrEqual(r.availableMinutes);
    // #18 Sciberras was only called up to game 2
    expect(rows.find((r) => r.player === 'Neil Sciberras')!.calledUp).toBe(1);
    // #12 Mifsud left out of game 2
    expect(rows.find((r) => r.player === 'Isaac Mifsud')!.calledUp).toBe(1);
  });

  it('team minutes add up to 11 players × match length', () => {
    const total = input.intervals.reduce((t, i) => t + (i.offMs - i.onMs), 0);
    const avail = input.matches.reduce((t, m) => t + m.durationMs!, 0);
    expect(total).toBe(11 * avail);
  });

  it('player filter returns one row', () => {
    expect(buildReport(input, 'team-melita-u14-p5')).toHaveLength(1);
  });
});

describe('sync mapping', () => {
  it('round-trips camelCase rows through snake_case', () => {
    const row = { id: 'x', matchId: 'm', onMs: 1, offMs: 2, updatedAt: 3, teamIds: ['a'] };
    expect(fromServer({ ...toServer(row), synced_at: 'now' })).toEqual(row);
  });
});
