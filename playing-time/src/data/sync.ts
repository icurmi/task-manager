// Offline-first sync. Every local write lands in IndexedDB first and is queued
// in the outbox; this engine pushes the outbox and pulls server changes
// whenever a connection is available. The match screen never waits on it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, getMeta, notifyChange, setMeta, SYNCED_TABLES, type SyncedTable } from './db';

const SERVER_TABLE: Record<SyncedTable, string> = {
  clubs: 'clubs',
  teams: 'teams',
  players: 'players',
  users: 'profiles',
  memberships: 'memberships',
  invitations: 'invitations',
  matches: 'matches',
  selections: 'match_selections',
  events: 'match_events',
  periods: 'periods',
  intervals: 'playing_intervals',
  audit: 'audit_log',
};

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function toServer(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[toSnake(k)] = v;
  return out;
}

export function fromServer(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'synced_at') continue;
    if (v !== null) out[toCamel(k)] = v;
  }
  return out;
}

export type SyncStatus = { state: 'offline' | 'idle' | 'syncing' | 'error' | 'local'; pending: number; lastSyncAt?: number; error?: string };

let status: SyncStatus = { state: 'local', pending: 0 };
const statusListeners = new Set<(s: SyncStatus) => void>();
export const onSyncStatus = (fn: (s: SyncStatus) => void) => {
  statusListeners.add(fn);
  fn(status);
  return () => {
    statusListeners.delete(fn);
  };
};
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  for (const l of statusListeners) l(status);
}

let client: SupabaseClient | null = null;
let running = false;

export function startSync(c: SupabaseClient) {
  client = c;
  const kick = () => void syncNow();
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());
  setInterval(kick, 30_000);
  kick();
}

export async function pendingCount() {
  return db.outbox.count();
}

export async function syncNow(): Promise<void> {
  if (!client) {
    setStatus({ state: 'local', pending: await pendingCount() });
    return;
  }
  if (running) return;
  if (!navigator.onLine) {
    setStatus({ state: 'offline', pending: await pendingCount() });
    return;
  }
  running = true;
  setStatus({ state: 'syncing' });
  try {
    await push(client);
    await pull(client);
    setStatus({ state: 'idle', pending: await pendingCount(), lastSyncAt: Date.now(), error: undefined });
  } catch (e) {
    setStatus({ state: 'error', pending: await pendingCount(), error: (e as Error).message });
  } finally {
    running = false;
  }
}

async function push(c: SupabaseClient) {
  const items = await db.outbox.orderBy('seq').limit(500).toArray();
  if (!items.length) return;
  for (const table of SYNCED_TABLES) {
    const batch = items.filter((i) => i.table === table);
    if (!batch.length) continue;
    const ids = [...new Set(batch.map((b) => b.rowId))];
    const rows = (await db.table(table).bulkGet(ids)).filter(Boolean);
    if (rows.length) {
      const { error } = await c.from(SERVER_TABLE[table]).upsert(rows.map(toServer));
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    await db.outbox.bulkDelete(batch.map((b) => b.seq!));
  }
  if ((await db.outbox.count()) > 0) await push(c);
}

async function pull(c: SupabaseClient) {
  const cursors = (await getMeta<Record<string, string>>('pullCursors')) ?? {};
  let changed = false;
  for (const table of SYNCED_TABLES) {
    const since = cursors[table] ?? '1970-01-01T00:00:00Z';
    const { data, error } = await c
      .from(SERVER_TABLE[table])
      .select('*')
      .gt('synced_at', since)
      .order('synced_at')
      .limit(1000);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) continue;
    // Rows still waiting in the outbox are newer locally – don't overwrite them.
    const pendingIds = new Set((await db.outbox.where('table').equals(table).toArray()).map((o) => o.rowId));
    const rows = data.map(fromServer).filter((r) => !pendingIds.has(r.id as string));
    await db.table(table).bulkPut(rows);
    cursors[table] = data[data.length - 1].synced_at as string;
    changed = true;
  }
  await setMeta('pullCursors', cursors);
  if (changed) notifyChange();
}
