import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clockAt, fmtClock, playerMs, rejectReason, type Action, type MatchState } from '../../domain/clock';
import type { Player } from '../../domain/types';
import { db } from '../../data/db';
import {
  appendEvent, discardMatch, finishMatch, isPractice, loadBundle, stateOf, undoLast, type MatchBundle,
} from '../../data/matches';
import {
  disableMediaSession, enableMediaSession, isNative, lockScreen, mediaSessionSupported, wakeLockSupported,
} from '../../native/matchControl';
import { useApp } from '../AppContext';
import { go, useLive, useNow } from '../hooks';

type Pick = { side: 'field' | 'bench'; id: string } | null;

export function MatchScreen({ matchId, openSub }: { matchId: string; openSub: boolean }) {
  const app = useApp();
  const [bundle, setBundle] = useState<MatchBundle | null | undefined>(undefined);
  const bundleRef = useRef<MatchBundle | null>(null);
  const queue = useRef(Promise.resolve());
  const [pick, setPick] = useState<Pick>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mediaOn, setMediaOn] = useState(false);
  const [toast, setToast] = useState('');
  const [subFocus, setSubFocus] = useState(openSub);

  useEffect(() => setSubFocus(openSub), [openSub]);

  useEffect(() => {
    loadBundle(matchId).then((b) => {
      bundleRef.current = b ?? null;
      setBundle(b ?? null);
    });
  }, [matchId]);

  const players = useLive(async () => {
    const b = await loadBundle(matchId);
    if (!b) return new Map<string, Player>();
    const list = await db.players.bulkGet(b.selections.map((s) => s.playerId));
    return new Map(list.filter(Boolean).map((p) => [p!.id, p!]));
  }, [matchId]);

  const state: MatchState | null = useMemo(() => (bundle ? stateOf(bundle) : null), [bundle]);
  const now = useNow(state?.phase === 'running');
  const team = app.teams.find((t) => t.id === bundle?.match.teamId);
  const practice = bundle ? isPractice(bundle.match.id) : false;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 2200);
  };

  /** All writes go through one queue so app taps and lock-screen taps never race. */
  const run = useCallback((fn: (b: MatchBundle) => Promise<MatchBundle | void>) => {
    queue.current = queue.current.then(async () => {
      const b = bundleRef.current;
      if (!b) return;
      const next = await fn(b);
      if (next) {
        bundleRef.current = next;
        setBundle(next);
      }
    }).catch((e) => console.error(e));
    return queue.current;
  }, []);

  const act = useCallback(
    (action: Action, at = Date.now(), source = 'app') =>
      run(async (b) => {
        const s = stateOf(b);
        const why = rejectReason(s, action, b.match.sportConfig);
        if (why) {
          if (source === 'app') flash(why);
          return;
        }
        // Keep the log monotonic even if a queued lock-screen tap arrives late.
        const t = Math.max(at, b.events.at(-1)?.at ?? 0);
        if (navigator.vibrate) navigator.vibrate(30);
        return appendEvent(b, { type: action.type, at: t, source, ...(action.type === 'sub' ? { offId: action.offId, onId: action.onId } : {}) });
      }),
    [run],
  );

  // ---- Lock screen / phone-away integration ----
  const title = bundle ? headerTitle(app.club.shortName, team?.name ?? '', bundle.match.opponent) : '';

  const drain = useCallback(async () => {
    const actions = await lockScreen.drain();
    for (const a of actions) await act({ type: a.type }, a.at, 'lockscreen');
  }, [act]);

  useEffect(() => {
    if (!bundle || bundle.match.status !== 'live') return;
    void lockScreen.start(lockState(bundle, stateOf(bundle), title));
    void drain();
    const off = lockScreen.onPending(() => void drain());
    const onVis = () => document.visibilityState === 'visible' && void drain();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void off.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.match.id, bundle?.match.status]);

  useEffect(() => {
    if (!bundle || !state || bundle.match.status !== 'live') return;
    void lockScreen.update(lockState(bundle, state, title), fmtClock(clockAt(state, Date.now())));
  }, [bundle, state, title, Math.floor(now / 5000)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => disableMediaSession(), []);

  if (bundle === undefined || !players) return <div className="splash">Loading…</div>;
  if (bundle === null || !state)
    return (
      <div className="page center">
        <p>Match not found.</p>
        <button className="btn" onClick={() => go('', true)}>Home</button>
      </div>
    );
  if (bundle.match.status === 'finished') {
    go(`summary/${bundle.match.id}`, true);
    return null;
  }

  const clock = clockAt(state, now);
  const ms = playerMs(state, now);
  const cur = state.periods.at(-1);
  const periodClock = state.phase === 'running' && cur ? clock - cur.clockStartMs : null;
  const cfg = bundle.match.sportConfig;
  const byNumber = (a: string, b: string) => (players.get(a)?.shirtNumber ?? 999) - (players.get(b)?.shirtNumber ?? 999);
  const fieldSorted = [...state.onField].sort(byNumber);
  const benchSorted = [...state.bench].sort(byNumber);

  const tapPlayer = (side: 'field' | 'bench', id: string) => {
    setSubFocus(false);
    if (!pick || pick.side === side) {
      setPick(pick?.id === id ? null : { side, id });
      return;
    }
    const offId = side === 'field' ? id : pick.id;
    const onId = side === 'bench' ? id : pick.id;
    setPick(null);
    const off = players.get(offId), on = players.get(onId);
    void act({ type: 'sub', offId, onId }).then(() =>
      flash(`⇄ ${num(on)} ${on?.lastName ?? ''} on · ${num(off)} ${off?.lastName ?? ''} off`),
    );
  };

  const lastEv = bundle.events.at(-1);
  const undoLabel = lastEv
    ? lastEv.type === 'sub'
      ? `Undo sub ${num(players.get(lastEv.onId!))}⇄${num(players.get(lastEv.offId!))}`
      : lastEv.type === 'start'
        ? `Undo START`
        : `Undo PERIOD`
    : 'Undo';

  const pickedOffBlocked = (id: string) =>
    pick?.side === 'field' && !cfg.substitutedCanReturn && state.subbedOff.has(id);

  return (
    <div className={`match ${practice ? 'practice' : ''}`}>
      <header className="match-head">
        <button className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>⋯</button>
        <h1>{title}</h1>
        {practice ? <span className="badge">PRACTICE</span> : <span className="spacer" />}
      </header>

      <section className="clock-wrap" aria-live="polite">
        <div className={`clock ${state.phase}`}>{fmtClock(clock)}</div>
        <div className="period">
          {state.phase === 'pre' && 'READY – PRESS START'}
          {state.phase === 'running' && <>PERIOD {state.period} <span className="pclock">{fmtClock(periodClock ?? 0)}</span></>}
          {state.phase === 'break' && <>BREAK · after period {state.period}</>}
        </div>
      </section>

      <section className="controls">
        <button className="ctl start" disabled={state.phase === 'running'} onClick={() => void act({ type: 'start' })}>
          START{state.period > 0 && state.phase !== 'running' ? ` P${state.period + 1}` : ''}
        </button>
        <button className="ctl period" disabled={state.phase !== 'running'} onClick={() => void act({ type: 'period' })}>
          PERIOD
        </button>
        <button className="ctl end" onClick={() => setConfirmEnd(true)}>END<br />GAME</button>
      </section>

      <div className={`sub-hint ${subFocus || pick ? 'active' : ''}`}>
        {pick
          ? pick.side === 'field'
            ? `${num(players.get(pick.id))} ${players.get(pick.id)?.lastName} coming OFF → tap who comes ON`
            : `${num(players.get(pick.id))} ${players.get(pick.id)?.lastName} coming ON → tap who comes OFF`
          : 'SUB: tap player coming off, then player coming on'}
      </div>

      <section className="columns">
        <div className="col">
          <h2>ON FIELD <span>{state.onField.length}/{cfg.playersOnField}</span></h2>
          <ul>
            {fieldSorted.map((id) => (
              <PlayerRow key={id} p={players.get(id)} ms={ms.get(id) ?? 0} side="field"
                selected={pick?.id === id} onTap={() => tapPlayer('field', id)} />
            ))}
          </ul>
        </div>
        <div className="col bench">
          <h2>BENCH <span>{state.bench.length}</span></h2>
          <ul>
            {benchSorted.map((id) => (
              <PlayerRow key={id} p={players.get(id)} ms={ms.get(id) ?? 0} side="bench"
                selected={pick?.id === id}
                disabled={!cfg.substitutedCanReturn && state.subbedOff.has(id)}
                dim={pickedOffBlocked(id)}
                onTap={() => tapPlayer('bench', id)} />
            ))}
          </ul>
        </div>
      </section>

      <footer className="match-foot">
        <button className="btn undo" disabled={!lastEv} onClick={() => { setPick(null); void run(undoLast).then(() => flash('Undone')); }}>
          ↶ {undoLabel}
        </button>
      </footer>

      {toast && <div className="toast">{toast}</div>}

      {confirmEnd && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>End the game?</h2>
            <p>Final time <strong>{fmtClock(clock)}</strong> after {state.period} period{state.period === 1 ? '' : 's'}.</p>
            <HoldButton label="Hold to end game" onDone={async () => {
              setConfirmEnd(false);
              await run((b) => finishMatch(b, Date.now()));
              await lockScreen.end();
              go(`summary/${bundle.match.id}`, true);
            }} />
            <button className="btn big" onClick={() => setConfirmEnd(false)}>Cancel – keep playing</button>
          </div>
        </div>
      )}

      {menu && (
        <div className="drawer-backdrop" onClick={() => setMenu(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head"><strong>{title}</strong><span className="muted small">Match keeps running in the background.</span></div>
            {!isNative && (
              <div className="drawer-note small">
                Screen stays on: {wakeLockSupported ? 'yes' : 'not supported by this browser'}
              </div>
            )}
            {!isNative && mediaSessionSupported && (
              <button onClick={async () => {
                if (mediaOn) { disableMediaSession(); setMediaOn(false); return; }
                const ok = await enableMediaSession({
                  onStart: () => void act({ type: 'start' }, Date.now(), 'media'),
                  onPeriod: () => void act({ type: 'period' }, Date.now(), 'media'),
                });
                setMediaOn(ok);
                flash(ok ? 'Lock-screen media controls on: ▶ START · ⏸ PERIOD' : 'Media controls unavailable');
              }}>
                {mediaOn ? 'Turn off lock-screen media controls' : 'Lock-screen media controls (▶ START / ⏸ PERIOD)'}
              </button>
            )}
            <button onClick={() => { setMenu(false); go('matches'); }}>Leave to menu (match keeps running)</button>
            {state.phase === 'pre' && (
              <button className="danger" onClick={async () => { await discardMatch(bundle.match.id); await lockScreen.end(); go('', true); }}>
                Discard this match
              </button>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}

function PlayerRow({ p, ms, side, selected, disabled, dim, onTap }: {
  p?: Player; ms: number; side: 'field' | 'bench'; selected: boolean; disabled?: boolean; dim?: boolean; onTap: () => void;
}) {
  return (
    <li>
      <button className={`prow ${side} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`} disabled={disabled || dim} onClick={onTap}>
        <span className="num">{p?.shirtNumber ?? '–'}</span>
        <span className="name">{p?.lastName.toUpperCase() ?? '?'}</span>
        <span className="mins">{fmtClock(ms)}</span>
      </button>
    </li>
  );
}

/** Press-and-hold confirmation: impossible to trigger with a stray tap in a pocket. */
function HoldButton({ label, onDone, ms = 1200 }: { label: string; onDone: () => void; ms?: number }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const start = () => {
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      setProgress(p);
      if (p >= 1) { timer.current = null; onDone(); return; }
      timer.current = requestAnimationFrame(tick);
    };
    timer.current = requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (timer.current) cancelAnimationFrame(timer.current);
    timer.current = null;
    setProgress(0);
  };
  return (
    <button
      className="btn big danger hold"
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.repeat) start(); }} onKeyUp={cancel}
      style={{ ['--p' as string]: progress }}
    >
      <span>{label}</span>
    </button>
  );
}

export function headerTitle(club: string, team: string, opponent: string) {
  return `${club} ${team}${opponent ? ` vs ${opponent}` : ''}`.toUpperCase();
}

const num = (p?: Player) => (p?.shirtNumber != null ? `#${p.shirtNumber}` : '');

function lockState(b: MatchBundle, s: MatchState, title: string) {
  return {
    matchId: b.match.id,
    title,
    period: s.period,
    phase: s.phase,
    bankedMs: s.bankedMs,
    runningSince: s.runningSince,
    onField: s.onField.length,
  };
}
