import { useMemo, useState } from 'react';
import { reportScopes, type ReportScope } from '../../domain/access';
import { buildReport } from '../../domain/stats';
import { db } from '../../data/db';
import { exportReport } from '../../reports/xlsx';
import { useApp } from '../AppContext';
import { useLive } from '../hooks';
import { Shell } from '../Shell';
import { sortPlayers } from './NewMatch';

const SCOPE_LABEL: Record<ReportScope, string> = {
  club: 'Whole club / season',
  team: 'One team',
  range: 'Date range',
  player: 'One player',
  match: 'One match',
};

export function Reports({ initialMatch, initialPlayer }: { initialMatch?: string; initialPlayer?: string }) {
  const app = useApp();
  const scopes = reportScopes(app.membership);
  const [scope, setScope] = useState<ReportScope>(initialMatch ? 'match' : initialPlayer ? 'player' : scopes[0]);
  const [teamId, setTeamId] = useState(app.teams[0]?.id ?? '');
  const [matchId, setMatchId] = useState(initialMatch ?? '');
  const [playerId, setPlayerId] = useState(initialPlayer ?? '');
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const teamIds = app.teams.map((t) => t.id);
  const data = useLive(async () => {
    const matches = (await db.matches.where('teamId').anyOf(teamIds).toArray()).filter((m) => m.status === 'finished' && !m.deleted);
    const mids = matches.map((m) => m.id);
    const [selections, intervals, players] = await Promise.all([
      db.selections.where('matchId').anyOf(mids).toArray(),
      db.intervals.where('matchId').anyOf(mids).toArray(),
      db.players.where('teamId').anyOf(teamIds).toArray(),
    ]);
    matches.sort((a, b) => (b.kickoffAt ?? 0) - (a.kickoffAt ?? 0));
    return { matches, selections, intervals, players };
  }, [teamIds.join()]);

  const filtered = useMemo(() => {
    if (!data) return null;
    let ms = data.matches;
    let label = app.club.name;
    if (scope === 'team' || scope === 'range' || scope === 'player') {
      ms = ms.filter((m) => m.teamId === teamId);
      label = `${app.club.name} ${app.teams.find((t) => t.id === teamId)?.name ?? ''}`;
    }
    if (scope === 'range') {
      const f = new Date(from + 'T00:00').getTime(), t = new Date(to + 'T23:59:59').getTime();
      ms = ms.filter((m) => (m.kickoffAt ?? m.createdAt) >= f && (m.kickoffAt ?? m.createdAt) <= t);
      label += ` · ${from} to ${to}`;
    }
    if (scope === 'match') {
      ms = ms.filter((m) => m.id === matchId);
      const m = ms[0];
      label = m ? `${app.teams.find((t) => t.id === m.teamId)?.name} vs ${m.opponent || '—'} · ${new Date(m.kickoffAt ?? 0).toLocaleDateString()}` : '';
    }
    if (scope === 'club') label += ` · season ${app.club.season}`;
    const ids = new Set(ms.map((m) => m.id));
    const input = {
      matches: ms,
      selections: data.selections.filter((s) => ids.has(s.matchId)),
      intervals: data.intervals.filter((i) => ids.has(i.matchId)),
      players: data.players,
      teams: app.teams,
    };
    const rows = buildReport(input, scope === 'player' ? playerId || undefined : undefined);
    if (scope === 'player') {
      const p = data.players.find((x) => x.id === playerId);
      label = p ? `${p.firstName} ${p.lastName}` : label;
    }
    return { rows, label, input };
  }, [data, scope, teamId, matchId, playerId, from, to, app]);

  if (!data || !filtered) return <Shell title="Reports"><p>Loading…</p></Shell>;
  const teamPlayers = data.players.filter((p) => p.teamId === teamId && !p.deleted).sort(sortPlayers);
  const needsPick = (scope === 'match' && !matchId) || (scope === 'player' && !playerId);

  return (
    <Shell title="Reports">
      <div className="stack">
        <label>
          Report
          <select value={scope} onChange={(e) => setScope(e.target.value as ReportScope)}>
            {scopes.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
        </label>
        {(scope === 'team' || scope === 'range' || scope === 'player') && app.teams.length > 1 && (
          <label>
            Team
            <select value={teamId} onChange={(e) => { setTeamId(e.target.value); setPlayerId(''); }}>
              {app.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        {scope === 'range' && (
          <div className="row gap">
            <label className="grow">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="grow">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}
        {scope === 'player' && (
          <label>
            Player
            <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              <option value="">Choose…</option>
              {teamPlayers.map((p) => <option key={p.id} value={p.id}>{p.shirtNumber ?? '–'} {p.firstName} {p.lastName}</option>)}
            </select>
          </label>
        )}
        {scope === 'match' && (
          <label>
            Match
            <select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
              <option value="">Choose…</option>
              {data.matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {new Date(m.kickoffAt ?? m.createdAt).toLocaleDateString()} · {app.teams.find((t) => t.id === m.teamId)?.name} vs {m.opponent || '—'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!needsPick && (
        <>
          <h3>{filtered.label}</h3>
          <p className="muted small">{filtered.input.matches.length} match(es)</p>
          <div className="table-scroll">
            <table className="report">
              <thead>
                <tr><th>Player</th><th>Team</th><th>Called Up</th><th>Starts</th><th>Apps</th><th>Min</th><th>Avail</th><th>%</th></tr>
              </thead>
              <tbody>
                {filtered.rows.map((r) => (
                  <tr key={r.playerId}>
                    <td>{r.player}</td><td>{r.team}</td><td>{r.calledUp}</td><td>{r.starts}</td><td>{r.appearances}</td>
                    <td>{r.minutes}</td><td>{r.availableMinutes}</td><td><strong>{Math.round(r.pctPlayed * 100)}%</strong></td>
                  </tr>
                ))}
                {filtered.rows.length === 0 && <tr><td colSpan={8} className="muted">No finished matches in this scope.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="sticky-foot">
            <button className="btn primary big" disabled={busy || filtered.rows.length === 0} onClick={async () => {
              setBusy(true);
              try {
                const ms = filtered.input.matches;
                await exportReport(filtered.rows, {
                  title: `Playing time – ${filtered.label}`,
                  subtitle: `Exported ${new Date().toLocaleString()} by ${app.user.name}`,
                  filename: `playing-time-${filtered.label}`,
                  matches: ms.length <= 40 ? ms.map((m) => ({
                    match: m,
                    intervals: filtered.input.intervals.filter((i) => i.matchId === m.id && !i.deleted && (scope !== 'player' || i.playerId === playerId)),
                    players: data.players,
                  })) : undefined,
                });
              } finally {
                setBusy(false);
              }
            }}>
              {busy ? 'Preparing…' : 'Export Excel (.xlsx)'}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}
