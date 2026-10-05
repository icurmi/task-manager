import { fmtClock } from '../../domain/clock';
import { db } from '../../data/db';
import { useApp } from '../AppContext';
import { go, useLive } from '../hooks';
import { Shell } from '../Shell';

export function History() {
  const { teams } = useApp();
  const ids = teams.map((t) => t.id);
  const matches = useLive(
    async () =>
      (await db.matches.where('teamId').anyOf(ids).toArray())
        .filter((m) => !m.deleted)
        .sort((a, b) => (b.kickoffAt ?? b.createdAt) - (a.kickoffAt ?? a.createdAt)),
    [ids.join()],
  );
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? '';
  return (
    <Shell title="Matches">
      {!matches ? <p>Loading…</p> : matches.length === 0 ? <p className="muted">No matches yet.</p> : (
        <ul className="list">
          {matches.map((m) => (
            <li key={m.id}>
              <button className="list-row" onClick={() => go(m.status === 'live' ? `match/${m.id}` : `summary/${m.id}`)}>
                <span>
                  <strong>{name(m.teamId)} vs {m.opponent || '—'}</strong>
                  <span className="muted small block">{new Date(m.kickoffAt ?? m.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </span>
                {m.status === 'live' ? <span className="badge live">LIVE</span> : <span className="muted">{fmtClock(m.durationMs ?? 0)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
