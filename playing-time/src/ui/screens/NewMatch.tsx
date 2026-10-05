import { useMemo, useState } from 'react';
import { canRunMatches } from '../../domain/access';
import { DEFAULT_SPORT_CONFIG, type Player } from '../../domain/types';
import { db } from '../../data/db';
import { createMatch } from '../../data/matches';
import { useApp } from '../AppContext';
import { go, useLive } from '../hooks';
import { Shell } from '../Shell';

export function sortPlayers(a: Player, b: Player) {
  return (a.shirtNumber ?? 999) - (b.shirtNumber ?? 999) || a.lastName.localeCompare(b.lastName);
}

export function NewMatch({ teamId }: { teamId: string }) {
  const app = useApp();
  const team = app.teams.find((t) => t.id === teamId);
  const roster = useLive(
    async () => (await db.players.where('teamId').equals(teamId).toArray()).filter((p) => p.active && !p.deleted).sort(sortPlayers),
    [teamId],
  );
  const config = team?.sportConfig ?? app.club.sportConfig ?? DEFAULT_SPORT_CONFIG;

  const [step, setStep] = useState<1 | 2>(1);
  const [opponent, setOpponent] = useState('');
  const [practice, setPractice] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => (roster ?? []).filter((p) => picked.has(p.id)), [roster, picked]);

  if (!team || !canRunMatches(app.membership)) return <Shell title="New match"><p>Team not available.</p></Shell>;
  if (!roster) return <div className="splash">Loading…</div>;

  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  const sameAsLast = async () => {
    const last = (await db.matches.where('teamId').equals(teamId).toArray())
      .filter((m) => m.status === 'finished' && !m.deleted)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!last) return;
    const sels = await db.selections.where('matchId').equals(last.id).toArray();
    const active = new Set(roster.map((p) => p.id));
    setPicked(new Set(sels.filter((s) => active.has(s.playerId)).map((s) => s.playerId)));
    setStarting(new Set(sels.filter((s) => s.starting && active.has(s.playerId)).map((s) => s.playerId)));
  };

  const go2 = async () => {
    setBusy(true);
    const id = await createMatch({
      clubId: app.club.id,
      teamId,
      opponent,
      createdBy: app.user.id,
      sportConfig: config,
      practice,
      lineup: selected.map((p) => ({ playerId: p.id, starting: starting.has(p.id) })),
    });
    go(`match/${id}`, true);
  };

  const startCount = selected.filter((p) => starting.has(p.id)).length;

  if (step === 1)
    return (
      <Shell title={`${team.name} — New Match`}>
        <div className="stack">
          <label>
            Opponent <span className="muted small">(optional)</span>
            <input
              value={opponent}
              placeholder="e.g. Sliema, Tournament Game 3"
              onChange={(e) => setOpponent(e.target.value)}
              autoCapitalize="words"
            />
          </label>
          <div className="row between">
            <h3>Who's called up? <span className="muted">{picked.size}</span></h3>
            <div className="row gap">
              <button className="btn small" onClick={sameAsLast}>Same as last</button>
              <button
                className="btn small"
                onClick={() => setPicked(picked.size === roster.length ? new Set() : new Set(roster.map((p) => p.id)))}
              >
                {picked.size === roster.length ? 'None' : 'All'}
              </button>
            </div>
          </div>
          <ul className="checklist">
            {roster.map((p) => (
              <li key={p.id}>
                <label className={picked.has(p.id) ? 'checked' : ''}>
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => setPicked(toggle(picked, p.id))} />
                  <span className="num">{p.shirtNumber ?? '–'}</span>
                  <span className="name">{p.firstName} <strong>{p.lastName}</strong></span>
                </label>
              </li>
            ))}
          </ul>
          <label className="row gap practice">
            <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
            Practice mode <span className="muted small">– nothing is saved</span>
          </label>
        </div>
        <div className="sticky-foot">
          <button className="btn primary big" disabled={picked.size === 0} onClick={() => setStep(2)}>
            Next: line-up ({picked.size})
          </button>
        </div>
      </Shell>
    );

  return (
    <Shell title={`${team.name} — Line-up`}>
      <p className="muted">Tap a player to switch between <strong>Starting</strong> and <strong>Bench</strong>.</p>
      <p className={`count ${startCount === config.playersOnField ? 'ok' : 'warn'}`}>
        Starting {startCount} / {config.playersOnField}
      </p>
      <ul className="lineup">
        {selected.map((p) => {
          const s = starting.has(p.id);
          return (
            <li key={p.id}>
              <button className={`lineup-row ${s ? 'starting' : 'bench'}`} onClick={() => setStarting(toggle(starting, p.id))}>
                <span className="num">{p.shirtNumber ?? '–'}</span>
                <span className="name">{p.lastName.toUpperCase()} <span className="muted small">{p.firstName}</span></span>
                <span className="tag">{s ? 'STARTING' : 'BENCH'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sticky-foot row gap">
        <button className="btn big" onClick={() => setStep(1)}>Back</button>
        <button className="btn primary big grow" disabled={busy || startCount === 0} onClick={go2}>
          {practice ? 'Go to match (practice)' : 'Go to match'}
        </button>
      </div>
    </Shell>
  );
}
