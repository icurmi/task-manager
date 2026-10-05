import { replay } from '../domain/clock';
import type {
  Club, Match, MatchEvent, Membership, Period, Player, PlayingInterval, Selection, Team, UserProfile,
} from '../domain/types';
import { DEFAULT_SPORT_CONFIG } from '../domain/types';
import { db } from './db';

export const SEED_CLUB_ID = 'club-melita';
export const SEED_USERS = {
  coach: 'user-coach-u14',
  headCoach: 'user-head-coach',
  admin: 'user-club-admin',
} as const;

const U14 = 'team-melita-u14';

// 18 players for Melita FC U14. Shirt numbers 1–18 + realistic Maltese names.
const U14_PLAYERS: [number, string, string][] = [
  [1, 'Luke', 'Borg'],
  [2, 'Matthias', 'Camilleri'],
  [3, 'Jake', 'Vella'],
  [4, 'Kyle', 'Farrugia'],
  [5, 'Ryan', 'Zammit'],
  [6, 'Nathan', 'Galea'],
  [7, 'Zach', 'Micallef'],
  [8, 'Miguel', 'Grech'],
  [9, 'Kurt', 'Attard'],
  [10, 'Jean', 'Spiteri'],
  [11, 'Matteo', 'Azzopardi'],
  [12, 'Isaac', 'Mifsud'],
  [13, 'Liam', 'Agius'],
  [14, 'Aiden', 'Caruana'],
  [15, 'Jayden', 'Cassar'],
  [16, 'Gabriel', 'Debono'],
  [17, 'Ethan', 'Pace'],
  [18, 'Neil', 'Sciberras'],
];

const OTHER_TEAMS: [string, string, [number, string, string][]][] = [
  ['team-melita-u12', 'U12', [
    [1, 'Owen', 'Formosa'], [2, 'Leon', 'Bonnici'], [3, 'Dylan', 'Schembri'], [4, 'Noah', 'Ellul'],
    [5, 'Adam', 'Busuttil'], [6, 'Elija', 'Gauci'], [7, 'Thomas', 'Muscat'], [8, 'Ben', 'Sammut'],
    [9, 'Jacob', 'Cutajar'], [10, 'Sean', 'Tabone'], [11, 'Andrea', 'Bugeja'], [12, 'Carl', 'Scerri'],
  ]],
  ['team-melita-u16', 'U16', [
    [1, 'Mark', 'Saliba'], [2, 'Daniel', 'Xuereb'], [3, 'Andrew', 'Mangion'], [4, 'Clayton', 'Portelli'],
    [5, 'Julian', 'Fenech'], [6, 'Karl', 'Baldacchino'], [7, 'Dejan', 'Cachia'], [8, 'Shaun', 'Briffa'],
    [9, 'Nikolai', 'Gatt'], [10, 'Brandon', 'Aquilina'], [11, 'Paul', 'Bartolo'], [12, 'Jurgen', 'Calleja'],
    [13, 'Rodney', 'Psaila'], [14, 'Kristian', 'Mallia'],
  ]],
];

export async function isSeeded() {
  return (await db.clubs.count()) > 0;
}

/** Pure seed rows (also used to generate supabase/seed.sql). */
export function seedData(now = Date.now()) {
  const club: Club = {
    id: SEED_CLUB_ID, updatedAt: now, name: 'Melita FC', shortName: 'MELITA', country: 'Malta',
    season: '2026/27', sportConfig: DEFAULT_SPORT_CONFIG,
  };
  const teams: Team[] = [
    { id: U14, clubId: club.id, updatedAt: now, name: 'U14', ageGroup: 'U14' },
    ...OTHER_TEAMS.map(([id, name]) => ({ id, clubId: club.id, updatedAt: now, name, ageGroup: name })),
  ];
  const mkPlayers = (teamId: string, list: [number, string, string][]): Player[] =>
    list.map(([n, f, l]) => ({
      id: `${teamId}-p${n}`, clubId: club.id, teamId, updatedAt: now,
      firstName: f, lastName: l, shirtNumber: n, active: true,
    }));
  const players = [
    ...mkPlayers(U14, U14_PLAYERS),
    ...OTHER_TEAMS.flatMap(([id, , list]) => mkPlayers(id, list)),
  ];
  const users: UserProfile[] = [
    { id: SEED_USERS.coach, updatedAt: now, email: 'coach.u14@melitafc.test', name: 'Mario Borg (U14 Coach)' },
    { id: SEED_USERS.headCoach, updatedAt: now, email: 'youth@melitafc.test', name: 'Joseph Vella (Head of Youth)' },
    { id: SEED_USERS.admin, updatedAt: now, email: 'admin@melitafc.test', name: 'Anna Zammit (Club Admin)' },
  ];
  const memberships: Membership[] = [
    { id: 'm-coach', clubId: club.id, userId: SEED_USERS.coach, updatedAt: now, role: 'coach', teamIds: [U14], ageGroups: [] },
    { id: 'm-head', clubId: club.id, userId: SEED_USERS.headCoach, updatedAt: now, role: 'head_coach', teamIds: [], ageGroups: ['U12', 'U14'] },
    { id: 'm-admin', clubId: club.id, userId: SEED_USERS.admin, updatedAt: now, role: 'club_admin', teamIds: [], ageGroups: [] },
  ];

  const history = [
    buildHistoricMatch('seed-match-1', 'Sliema Wanderers', now - 14 * 86400_000, 0),
    buildHistoricMatch('seed-match-2', 'Tournament Game 3', now - 7 * 86400_000, 1),
  ];

  return { club, teams, players, users, memberships, history };
}

export async function seedDemo(): Promise<void> {
  const { club, teams, players, users, memberships, history } = seedData();
  // Seed data is local demo data – written directly (not queued for sync).
  await db.transaction('rw', db.tables, async () => {
    await db.clubs.put(club);
    await db.teams.bulkPut(teams);
    await db.players.bulkPut(players);
    await db.users.bulkPut(users);
    await db.memberships.bulkPut(memberships);
    for (const h of history) {
      await db.matches.put(h.match);
      await db.selections.bulkPut(h.selections);
      await db.events.bulkPut(h.events);
      await db.periods.bulkPut(h.periods);
      await db.intervals.bulkPut(h.intervals);
    }
  });
}

/** Builds a realistic finished match by replaying events through the real engine. */
function buildHistoricMatch(id: string, opponent: string, kickoff: number, variant: number) {
  const ids = U14_PLAYERS.map(([n]) => `${U14}-p${n}`);
  const called = variant === 0 ? ids.slice(0, 16) : [...ids.slice(0, 11), ...ids.slice(12, 18)];
  const starters = called.slice(0, 11);
  const bench = called.slice(11);
  const MIN = 60_000;
  const raw: [MatchEvent['type'], number, string?, string?][] = [
    ['start', 0],
    ['sub', 20 * MIN + 12_000, starters[10], bench[0]],
    ['sub', 25 * MIN, starters[9], bench[1]],
    ['period', 35 * MIN + 41_000],
    ['sub', 45 * MIN, starters[8], bench[2]],
    ['sub', 45 * MIN, bench[0], starters[10]],
    ['start', 47 * MIN],
    ['sub', 62 * MIN + 30_000, starters[7], bench[3]],
    ['sub', 66 * MIN, bench[1], bench[4] ?? starters[9]],
    ['period', 82 * MIN + 5_000],
    ['end', 83 * MIN],
  ];
  const events: MatchEvent[] = raw.map(([type, off, offId, onId], i) => ({
    id: `${id}-e${i}`, clubId: SEED_CLUB_ID, matchId: id, updatedAt: kickoff, seq: i + 1,
    type, at: kickoff + off, offId, onId, source: 'app',
  }));
  const s = replay(starters, bench, events, DEFAULT_SPORT_CONFIG);
  const match: Match = {
    id, clubId: SEED_CLUB_ID, teamId: U14, opponent, createdBy: SEED_USERS.coach,
    createdAt: kickoff - 30 * MIN, updatedAt: kickoff, status: 'finished',
    sportConfig: DEFAULT_SPORT_CONFIG, kickoffAt: kickoff, endedAt: kickoff + 83 * MIN,
    durationMs: s.bankedMs,
  };
  const selections: Selection[] = called.map((pid) => ({
    id: `${id}-s-${pid}`, clubId: SEED_CLUB_ID, matchId: id, playerId: pid,
    starting: starters.includes(pid), updatedAt: kickoff,
  }));
  const periods: Period[] = s.periods.map((p) => ({
    id: `${id}-per${p.number}`, clubId: SEED_CLUB_ID, matchId: id, number: p.number,
    startedAt: p.startedAt, endedAt: p.endedAt!, clockStartMs: p.clockStartMs, clockEndMs: p.clockEndMs!,
    updatedAt: kickoff,
  }));
  const intervals: PlayingInterval[] = s.intervals.map((iv, i) => ({
    id: `${id}-iv${i}`, clubId: SEED_CLUB_ID, matchId: id, playerId: iv.playerId,
    onMs: iv.onMs, offMs: iv.offMs!, updatedAt: kickoff,
  }));
  return { match, selections, events, periods, intervals };
}
