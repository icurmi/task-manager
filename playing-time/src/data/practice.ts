import type { MatchBundle } from './matches';

// Practice matches never touch IndexedDB or the server. They live in
// sessionStorage only so a reload mid-practice doesn't lose the clock;
// closing the tab or leaving the summary throws them away.
const KEY = 'pt-practice-match';

export const practiceStore = {
  get(): MatchBundle | undefined {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as MatchBundle) : undefined;
    } catch {
      return undefined;
    }
  },
  set(b: MatchBundle) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(b));
    } catch {
      /* storage unavailable – practice still works in memory for this view */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
