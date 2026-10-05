import { useState } from 'react';
import { canCorrectMatch, canRunMatches } from '../../domain/access';
import { fmtClock, minutesOf, parseClock } from '../../domain/clock';
import { matchLines } from '../../domain/stats';
import type { AuditEntry, Match, Player, PlayingInterval, Selection } from '../../domain/types';
import { db } from '../../data/db';
import {
  auditOf, correctInterval, intervalsOf, isPractice, loadBundle, periodsOf, stateOf, validateInterval,
} from '../../data/matches';
import { practiceStore } from '../../data/practice';
import { exportReport } from '../../reports/xlsx';
import { buildReport } from '../../domain/stats';
import { useApp } from '../AppContext';
import { go, useLive } from '../hooks';
import { Shell } from '../Shell';
import { headerTitle } from './MatchScreen';
import { sortPlayers } from './NewMatch';

export function Summary({ matchId }: { matchId: string }) {
  const app = useApp();
  const data = useLive(async () => {
    const b = await loadBundle(matchId);
    if (!b) return null;
    const practice = isPractice(matchId);
    let intervals: PlayingInterval[];
    let periods: { number: number; clockStartMs: number; clockEndMs: number }[];
    if (practice) {
      const s = stateOf(b);
      intervals = s.intervals.map((iv, i) => ({ id: `p${i}`, updatedAt: 0, clubId: '', matchId, playerId: iv.playerId, onMs: iv.onMs, offMs: iv.offMs ?? s.bankedMs }));
      periods = s.periods.map((p) => ({ number: p.number, clockStartMs: p.clockStartMs, clockEndMs: p.clockEndMs ?? s.bankedMs }));
    } else {
      [intervals, periods] = await Promise.all([intervalsOf(matchId), periodsOf(matchId)]);
    }
    const players = (await db.players.bulkGet(b.selections.map((s) => s.playerId))).filter(Boolean) as Player[];
    const audit = practice ? [] : await auditOf(matchId);
    return { ...b, intervals, periods, players, audit, practice };
  }, [matchId]);

  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  if (data === undefined) return <div className="splash">Loading…</div>;
  if (data === null) return <Shell title="Match" back="matches"><p>Match not found.</p></Shell>;

  const { match, selections, intervals, periods, players, audit, practice } = data;
  if (match.status !== 'finished') {
    go(`match/${match.id}`, true);
    return null;
  }
  const team = app.teams.find((t) => t.id === match.teamId);
  const lines = new Map(matchLines(match, selections, intervals).map((l) => [l.playerId, l]));
  const sorted = [...players].sort((a, b) => {
    const la = lines.get(a.id)!, lb = lines.get(b.id)!;
    return Number(lb.started) - Number(la.started) || sortPlayers(a, b);
  });
  const canEdit = !practice && canRunMatches(app.membership) && canCorrectMatch(app.membership, app.teams, match.teamId);
  const title = headerTitle(app.club.shortName, team?.name ?? '', match.opponent);

  return (
    <Shell title="Match summary" back={practice ? undefined : 'matches'}>
      <h2 className="summary-title">{title}</h2>
      <p className="muted">
        {new Date(match.kickoffAt ?? match.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        {' · '}Total {fmtClock(match.durationMs ?? 0)}
        {' · '}{periods.map((p) => `P${p.number} ${fmtClock(p.clockEndMs - p.clockStartMs)}`).join(' · ')}
      </p>
      {practice && <p className="card warn">Practice match – nothing was saved.</p>}

      <table className="summary">
        <thead>
          <tr><th>#</th><th>Player</th><th>Started</th><th>Min</th><th>%</th></tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const l = lines.get(p.id)!;
            const open = openPlayer === p.id;
            return (
              <FragmentRows key={p.id}>
                <tr className={`clickable ${open ? 'open' : ''}`} onClick={() => setOpenPlayer(open ? null : p.id)}>
                  <td>{p.shirtNumber ?? '–'}</td>
                  <td>{p.firstName} <strong>{p.lastName}</strong></td>
                  <td>{l.started ? 'Yes' : 'No'}</td>
                  <td className="num-cell">{minutesOf(l.ms)}</td>
                  <td className="num-cell">
                    <div className="pct"><div style={{ width: `${Math.round(l.pct * 100)}%` }} /><span>{Math.round(l.pct * 100)}%</span></div>
                  </td>
                </tr>
                {open && (
                  <tr className="detail">
                    <td colSpan={5}>
                      <IntervalEditor
                        match={match} player={p} canEdit={canEdit}
                        intervals={intervals.filter((i) => i.playerId === p.id)}
                        editor={{ id: app.user.id, name: app.user.name }}
                      />
                    </td>
                  </tr>
                )}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Tap a player to see {canEdit ? 'and correct ' : ''}their ON/OFF intervals.</p>

      <div className="row gap wrap">
        {practice ? (
          <button className="btn primary big grow" onClick={() => { practiceStore.clear(); go('', true); }}>Done</button>
        ) : (
          <>
            <button className="btn big grow" onClick={() => exportMatch(match, selections, intervals, players, team?.name ?? '')}>Export .xlsx</button>
            {canRunMatches(app.membership) && <button className="btn primary big grow" onClick={() => go('', true)}>New match</button>}
          </>
        )}
      </div>

      {!practice && <AuditLog audit={audit} players={players} />}
    </Shell>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function IntervalEditor({ match, player, intervals, canEdit, editor }: {
  match: Match; player: Player; intervals: PlayingInterval[]; canEdit: boolean; editor: { id: string; name: string };
}) {
  const [draft, setDraft] = useState<Record<string, { on: string; off: string }>>({});
  const [adding, setAdding] = useState<{ on: string; off: string } | null>(null);
  const [err, setErr] = useState('');
  const dur = match.durationMs ?? 0;

  const save = async (iv: PlayingInterval | null, on: string, off: string) => {
    const onMs = parseClock(on), offMs = parseClock(off);
    if (onMs == null || offMs == null) return setErr('Use mm:ss, e.g. 32:14');
    const others = intervals.filter((o) => o.id !== iv?.id);
    const why = validateInterval(onMs, offMs, dur, others);
    if (why) return setErr(why);
    setErr('');
    if (iv) await correctInterval(match, editor, { action: 'edit', interval: iv, onMs, offMs });
    else await correctInterval(match, editor, { action: 'add', playerId: player.id, onMs, offMs });
    setDraft((d) => { const n = { ...d }; if (iv) delete n[iv.id]; return n; });
    setAdding(null);
  };

  return (
    <div className="intervals">
      {intervals.length === 0 && <p className="muted small">Did not play.</p>}
      {intervals.map((iv) => {
        const d = draft[iv.id];
        return (
          <div key={iv.id} className="iv-row">
            {d ? (
              <>
                ON <input inputMode="numeric" value={d.on} onChange={(e) => setDraft({ ...draft, [iv.id]: { ...d, on: e.target.value } })} />
                OFF <input inputMode="numeric" value={d.off} onChange={(e) => setDraft({ ...draft, [iv.id]: { ...d, off: e.target.value } })} />
                <button className="btn small primary" onClick={() => save(iv, d.on, d.off)}>Save</button>
                <button className="btn small" onClick={() => setDraft((x) => { const n = { ...x }; delete n[iv.id]; return n; })}>×</button>
              </>
            ) : (
              <>
                <span>ON <strong>{fmtClock(iv.onMs)}</strong> · OFF <strong>{fmtClock(iv.offMs)}</strong></span>
                <span className="muted small">{minutesOf(iv.offMs - iv.onMs)} min</span>
                {canEdit && (
                  <>
                    <button className="btn small" onClick={() => setDraft({ ...draft, [iv.id]: { on: fmtClock(iv.onMs), off: fmtClock(iv.offMs) } })}>Edit</button>
                    <button className="btn small danger" onClick={() => { if (confirm('Delete this interval?')) void correctInterval(match, editor, { action: 'delete', interval: iv }); }}>Delete</button>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
      {canEdit && (adding ? (
        <div className="iv-row">
          ON <input inputMode="numeric" value={adding.on} onChange={(e) => setAdding({ ...adding, on: e.target.value })} />
          OFF <input inputMode="numeric" value={adding.off} onChange={(e) => setAdding({ ...adding, off: e.target.value })} />
          <button className="btn small primary" onClick={() => save(null, adding.on, adding.off)}>Add</button>
          <button className="btn small" onClick={() => setAdding(null)}>×</button>
        </div>
      ) : (
        <button className="btn small" onClick={() => setAdding({ on: '00:00', off: fmtClock(dur) })}>+ Add interval</button>
      ))}
      {err && <p className="error small">{err}</p>}
    </div>
  );
}

function AuditLog({ audit, players }: { audit: AuditEntry[]; players: Player[] }) {
  if (!audit.length) return null;
  const name = (id: string) => players.find((p) => p.id === id)?.lastName ?? '?';
  const r = (x?: { onMs: number; offMs: number }) => (x ? `${fmtClock(x.onMs)}–${fmtClock(x.offMs)}` : '');
  return (
    <section className="audit">
      <h3>Change log</h3>
      <ul>
        {audit.map((a) => (
          <li key={a.id}>
            <span className="muted small">{new Date(a.at).toLocaleString()}</span>{' '}
            <strong>{a.userName}</strong>{' '}
            {a.action === 'add' && <>added {name(a.playerId)} {r(a.after)}</>}
            {a.action === 'edit' && <>changed {name(a.playerId)} {r(a.before)} → {r(a.after)}</>}
            {a.action === 'delete' && <>removed {name(a.playerId)} {r(a.before)}</>}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function exportMatch(match: Match, selections: Selection[], intervals: PlayingInterval[], players: Player[], teamName: string) {
  const team = await db.teams.get(match.teamId);
  const rows = buildReport({ matches: [match], selections, intervals, players, teams: team ? [team] : [] });
  await exportReport(rows, {
    title: `${teamName} vs ${match.opponent || 'match'}`,
    subtitle: new Date(match.kickoffAt ?? match.createdAt).toLocaleDateString(),
    filename: `playing-time-${teamName}-${match.opponent || 'match'}-${new Date(match.kickoffAt ?? match.createdAt).toISOString().slice(0, 10)}`,
    matches: [{ match, intervals, players }],
  });
}
