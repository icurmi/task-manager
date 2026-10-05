import { useEffect } from 'react';
import { canRunMatches } from '../../domain/access';
import { liveMatchFor } from '../../data/matches';
import { useApp } from '../AppContext';
import { go, useLive } from '../hooks';
import { Shell } from '../Shell';

/**
 * Landing logic – never ask what we can work out:
 *  - a match is live for my team → straight back into it
 *  - coach with one team         → "[Team] — New Match"
 *  - several teams               → pick a team
 *  - club admin                  → reports
 */
export function Home() {
  const { membership, teams } = useApp();
  const live = useLive(() => liveMatchFor(teams.map((t) => t.id)).then((m) => m ?? null), [teams]);

  useEffect(() => {
    if (live === undefined) return;
    if (!canRunMatches(membership)) return go('reports', true);
    if (live) return go(`match/${live.id}`, true);
    if (teams.length === 1) go(`new/${teams[0].id}`, true);
  }, [live, membership, teams]);

  if (live === undefined || !canRunMatches(membership) || live || teams.length === 1) return <div className="splash">Loading…</div>;

  return (
    <Shell title="New match">
      {teams.length === 0 ? (
        <p className="muted">You have no teams assigned yet. Ask your Club Admin.</p>
      ) : (
        <div className="stack">
          <p className="muted">Which team is playing?</p>
          {teams.map((t) => (
            <button key={t.id} className="btn big choice" onClick={() => go(`new/${t.id}`)}>
              <strong>{t.name}</strong>
            </button>
          ))}
        </div>
      )}
    </Shell>
  );
}
