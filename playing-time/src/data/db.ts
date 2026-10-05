import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry, Club, Invitation, Match, MatchEvent, Membership, OutboxItem, Period, Player,
  PlayingInterval, Selection, Team, UserProfile,
} from '../domain/types';

/** Local-first store. Everything the match screen needs lives here, so no network is ever required. */
export class PlayingTimeDB extends Dexie {
  clubs!: Table<Club, string>;
  teams!: Table<Team, string>;
  players!: Table<Player, string>;
  users!: Table<UserProfile, string>;
  memberships!: Table<Membership, string>;
  invitations!: Table<Invitation, string>;
  matches!: Table<Match, string>;
  selections!: Table<Selection, string>;
  events!: Table<MatchEvent, string>;
  periods!: Table<Period, string>;
  intervals!: Table<PlayingInterval, string>;
  audit!: Table<AuditEntry, string>;
  outbox!: Table<OutboxItem, number>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'playing-time') {
    super(name);
    this.version(1).stores({
      clubs: 'id',
      teams: 'id, clubId',
      players: 'id, teamId, clubId',
      users: 'id, email',
      memberships: 'id, userId, clubId',
      invitations: 'id, clubId, email',
      matches: 'id, teamId, clubId, status, createdAt',
      selections: 'id, matchId, playerId',
      events: 'id, matchId, [matchId+seq]',
      periods: 'id, matchId',
      intervals: 'id, matchId, playerId',
      audit: 'id, matchId',
      outbox: '++seq, table',
      meta: 'key',
    });
  }
}

export const db = new PlayingTimeDB();

/** Tables that are mirrored to the server. Order matters for foreign keys on push. */
export const SYNCED_TABLES = [
  'clubs', 'teams', 'players', 'users', 'memberships', 'invitations',
  'matches', 'selections', 'events', 'periods', 'intervals', 'audit',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Write rows locally and queue them for sync. */
export async function put<T extends { id: string; updatedAt: number }>(
  table: SyncedTable,
  rows: T | T[],
): Promise<void> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return;
  const now = Date.now();
  for (const r of list) r.updatedAt = now;
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).bulkPut(list);
    await db.outbox.bulkAdd(list.map((r) => ({ table, rowId: r.id, queuedAt: now })));
  });
  notifyChange();
}

/** Soft delete so the deletion syncs. */
export async function softDelete(table: SyncedTable, ids: string[]) {
  const rows = (await db.table(table).bulkGet(ids)).filter(Boolean);
  for (const r of rows) r.deleted = true;
  await put(table, rows);
}

const listeners = new Set<() => void>();
export function onChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function notifyChange() {
  for (const l of listeners) l();
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
