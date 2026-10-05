import { liveQuery } from 'dexie';
import { useEffect, useState, useSyncExternalStore } from 'react';

/** Re-runs a Dexie query whenever the tables it reads change. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Ticks while `active` so live clocks re-render. Values are always computed from timestamps. */
export function useNow(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}

// Routes live in memory and are mirrored to location.hash when the host allows it.
// Some embedded hosts (sandboxed frames) don't deliver hash changes, so the app never depends on them.
let currentRoute = typeof window !== 'undefined' ? window.location.hash.replace(/^#\/?/, '') : '';
const routeListeners = new Set<() => void>();

function subscribeRoute(cb: () => void) {
  routeListeners.add(cb);
  const onHash = () => {
    const h = window.location.hash.replace(/^#\/?/, '');
    if (h !== currentRoute) {
      currentRoute = h;
      routeListeners.forEach((l) => l());
    }
  };
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onHash);
  return () => {
    routeListeners.delete(cb);
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('popstate', onHash);
  };
}

export function useRoute(): { path: string[]; query: URLSearchParams } {
  const raw = useSyncExternalStore(subscribeRoute, () => currentRoute);
  const [p, q = ''] = raw.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export function go(path: string, replace = false) {
  currentRoute = path.replace(/^\//, '');
  try {
    const h = '#/' + currentRoute;
    if (replace) history.replaceState(null, '', h);
    else history.pushState(null, '', h);
  } catch {
    /* host doesn't allow URL changes – in-memory routing still works */
  }
  routeListeners.forEach((l) => l());
}

export function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}
