// Bridge to the phone's lock screen.
//  iOS     → Live Activity + Dynamic Island (ActivityKit, interactive App Intents)
//  Android → ongoing foreground-service notification with a live Chronometer
//  Web     → Screen Wake Lock + (optional) Media Session lock-screen controls
//
// The native side keeps a tiny copy of the clock (bankedMs, runningSince, period)
// so it can render a ticking clock and handle START / PERIOD taps while the JS
// app is suspended. Each tap is queued natively WITH ITS TIMESTAMP; the app
// drains the queue when it wakes and replays the taps at their original times.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Phase } from '../domain/clock';

export interface LockScreenState {
  matchId: string;
  title: string; // "MELITA U14 vs SLIEMA"
  period: number;
  phase: Phase;
  bankedMs: number;
  runningSince: number | null;
  onField: number;
}

export interface QueuedAction {
  type: 'start' | 'period';
  at: number;
}

interface MatchControlPlugin {
  startSession(state: LockScreenState): Promise<void>;
  updateSession(state: LockScreenState): Promise<void>;
  endSession(): Promise<void>;
  drainActions(): Promise<{ actions: QueuedAction[] }>;
  addListener(event: 'actionsPending', fn: () => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<MatchControlPlugin>('MatchControl');
export const isNative = Capacitor.isNativePlatform();

// ---------- Web fallbacks ----------

let wakeLock: WakeLockSentinel | null = null;
let wantWakeLock = false;

async function acquireWakeLock() {
  wantWakeLock = true;
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* denied (battery saver, not visible) – re-tried on visibility change */
  }
}
function releaseWakeLock() {
  wantWakeLock = false;
  void wakeLock?.release();
  wakeLock = null;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wantWakeLock && document.visibilityState === 'visible') void acquireWakeLock();
  });
}

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
export const mediaSessionSupported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

// Media Session: browsers only show lock-screen controls while media plays,
// so we loop a silent clip. play = START, pause/next = PERIOD.
let audio: HTMLAudioElement | null = null;
function silentWav(): string {
  const rate = 8000, secs = 2, n = rate * secs;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export interface WebMediaHandlers { onStart: () => void; onPeriod: () => void }

export async function enableMediaSession(h: WebMediaHandlers): Promise<boolean> {
  if (!mediaSessionSupported) return false;
  try {
    audio ??= Object.assign(new Audio(silentWav()), { loop: true, volume: 0.01 });
    await audio.play();
  } catch {
    return false;
  }
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => h.onStart());
  ms.setActionHandler('pause', () => h.onPeriod());
  try { ms.setActionHandler('nexttrack', () => h.onPeriod()); } catch { /* unsupported */ }
  return true;
}

export function disableMediaSession() {
  audio?.pause();
  if (!mediaSessionSupported) return;
  for (const a of ['play', 'pause', 'nexttrack'] as MediaSessionAction[]) {
    try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ }
  }
  navigator.mediaSession.metadata = null;
}

function updateMediaMetadata(s: LockScreenState, clockText: string) {
  if (!mediaSessionSupported || !audio || audio.paused) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `${clockText} · ${s.phase === 'running' ? `PERIOD ${s.period}` : s.phase === 'break' ? `BREAK after P${s.period}` : 'NOT STARTED'}`,
    artist: s.title,
    album: s.phase === 'running' ? '⏸ = end period' : '▶ = start',
  });
  navigator.mediaSession.playbackState = s.phase === 'running' ? 'playing' : 'paused';
}

// ---------- Public API used by the match screen ----------

export const lockScreen = {
  async start(s: LockScreenState) {
    await acquireWakeLock();
    if (isNative) await Native.startSession(s).catch(() => undefined);
  },
  async update(s: LockScreenState, clockText: string) {
    if (isNative) await Native.updateSession(s).catch(() => undefined);
    else updateMediaMetadata(s, clockText);
  },
  async end() {
    releaseWakeLock();
    disableMediaSession();
    if (isNative) await Native.endSession().catch(() => undefined);
  },
  async drain(): Promise<QueuedAction[]> {
    if (!isNative) return [];
    try {
      return (await Native.drainActions()).actions ?? [];
    } catch {
      return [];
    }
  },
  async onPending(fn: () => void): Promise<() => void> {
    if (!isNative) return () => undefined;
    const h = await Native.addListener('actionsPending', fn);
    return () => void h.remove();
  },
};
