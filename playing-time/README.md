# Player's Playing Time

Mobile-first, offline-first app that tracks every youth player's minutes during a match.
Built for **Melita FC (Malta)**, ready for any club.

> On the touchline it's a stopwatch with players attached. Clubs, permissions and
> reports all live outside the match screen.

---

## 1. Try it in 2 minutes (demo mode, no server)

```bash
cd playing-time
npm install
npm run dev            # http://localhost:5173  (open on your phone: same Wi-Fi, use the "Network" URL)
```

With no backend configured the app runs in **demo mode**. It seeds Melita FC on first load and keeps everything on the device:

| Demo user | Role | Lands on |
|---|---|---|
| Mario Borg | Coach, U14 | **U14 — New Match** |
| Joseph Vella | Head Coach / Coordinator, age groups U12 + U14 | Team picker |
| Anna Zammit | Club Admin | Reports (no match controls) |

Seed data: **Melita FC U14 with 18 players** (#1–#18), plus U12 and U16 squads, and two finished U14 matches so reports have data straight away.

To reset the demo, clear the site data in your browser (or use a private window).

### Test a match
1. Log in as **Mario Borg**. Opponent: `Sliema` (optional). Tap **All**, then untick anyone who isn't playing.
2. **Next: line-up**. Tap 11 players to make them *Starting*. **Go to match**.
3. **START** → the clock runs. Tap a green ON FIELD player, then a BENCH player. That's a sub.
4. **PERIOD** pauses for half-time (press it as many times as your format needs). **START** begins the next period.
5. **END GAME** → *hold* the red button to confirm → summary with started / minutes / %.
6. Tap any player in the summary to see their exact ON/OFF intervals and correct them. Every change is logged.
7. Menu → **Reports** → **Export Excel (.xlsx)**.

Tick **Practice mode** on the selection screen to run a match that saves nothing.

---

## 2. How timing works (why it survives anything)

The app never keeps a running counter. Each button press is stored as an **event with a wall-clock timestamp** (`start`, `period`, `sub`, `end`). The clock, the period number, who's on the field and every player's minutes are **derived** from that log (`src/domain/clock.ts`). Killing the app, locking the phone, a reload or the OS suspending the WebView therefore can't lose time: when the app comes back it recomputes from the timestamps.

- Match clock = sum of running periods only. Breaks don't count.
- Every player gets `PlayingInterval`s in match-clock time, e.g. `ON 00:00 OFF 32:14`, `ON 48:03 OFF 70:00`. They are written at END GAME and are what corrections edit.
- **Undo** removes the last START / PERIOD / SUB.
- Sport config (`playersOnField`, `substitutedCanReturn`) lives on the club, with an optional per-team override. Coaches never see it. When `substitutedCanReturn` is false, a player who has been subbed off is disabled on the bench.

Data model: `Club → Team → Player (roster) → Match → Selection (called up, starting?) → Events → Periods → PlayingIntervals`, plus `AuditEntry` for corrections. See `src/domain/types.ts`.

---

## 3. Lock screen / phone in pocket

| Platform | What you get | Code |
|---|---|---|
| **iOS 16.2+** | Live Activity on the lock screen + Dynamic Island: ticking clock, period, **START / PERIOD** buttons (interactive on iOS 17+), **Sub** link that opens the substitution view | `ios/App/MatchWidget/`, `ios/App/Shared/`, `ios/App/App/MatchControlPlugin.swift` |
| **Android** | Ongoing foreground-service notification on the lock screen with a live Chronometer and **START / PERIOD / Sub** actions | `android/app/src/main/java/mt/melitafc/playingtime/Match*.java` |
| **Web / PWA** | Screen Wake Lock keeps the screen on during a match. Optional: Match menu (⋯) → *Lock-screen media controls*, where ▶ = START and ⏸ = PERIOD | `src/native/matchControl.ts` |

How taps reach the app while it's asleep: the native side keeps a tiny copy of the clock (`bankedMs`, `runningSince`, `period`) and draws the clock with the system timer (`Text(timerInterval:)` / `Chronometer`), so it ticks without the app running. A START/PERIOD tap updates that copy straight away and is **queued with its timestamp**. When the app wakes, it drains the queue and replays each tap at its original time. "Sub" deep-links to `playingtime://match/<id>?sub=1`.

### Build the native apps

```bash
npm run build && npx cap sync
npx cap open android      # Android Studio → Run
npx cap open ios          # Xcode (macOS)
```

**Android** works as is: plugin, service, receiver, permissions and deep link are already registered. Android 13+ asks for notification permission at the first match.

**iOS: one-time Xcode steps.** A widget extension target can't be generated from the command line.
1. *Signing & Capabilities* on target **App**: set your Team, add **App Groups** → `group.mt.melitafc.playingtime` (the entitlements file already exists at `App/App.entitlements`).
2. *File → New → Target → Widget Extension*, name it **MatchWidget**, tick *Include Live Activity*. Delete the Swift files Xcode generates and add the files from `ios/App/MatchWidget/` instead.
3. Add `ios/App/Shared/MatchActivityAttributes.swift` and `MatchIntents.swift` to the **MatchWidget** target too (they're already in App): File Inspector → Target Membership.
4. On **MatchWidget**: add the same App Group (entitlements file: `MatchWidget/MatchWidget.entitlements`), and set the deployment target to iOS 16.2 or later.
5. Run on a real device. Live Activities don't appear in all simulators.

`Info.plist` already has `NSSupportsLiveActivities` and the `playingtime://` URL scheme.

---

## 4. Going live with accounts and sync (Supabase)

Without a backend, each device is its own island (demo mode). For a real club:

1. Create a project at [supabase.com](https://supabase.com).
2. SQL editor → run `supabase/migrations/0001_schema.sql`, then `supabase/seed.sql` (Melita FC teams + rosters). **First edit the two invitation emails at the bottom of seed.sql** to your own Club Admin and U14 coach.
3. Auth → URL configuration: add your app URL (and `capacitor://localhost`, `http://localhost` for the native apps) as redirect URLs.
4. Deploy the invite function:
   ```bash
   supabase functions deploy invite-coach
   supabase secrets set APP_URL=https://your-app-url
   ```
5. Create `playing-time/.env`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
6. `npm run build` and host `dist/` on any static host (Netlify, Vercel, Cloudflare Pages, or Supabase Storage). Or `npx cap sync` for the native apps.

How it behaves:
- **Login**: an emailed magic link. A coach must have been invited first (`shouldCreateUser: false`). When an invited email signs in for the first time, a database trigger turns the invitation into a membership.
- **Invites**: Club Admin → menu → *Coaches & invites*. Choose the role and the teams, or (for Head Coach) whole age groups.
- **Sync**: every write goes to IndexedDB first and into an outbox. When there's a connection, the outbox is pushed (upsert) and server changes are pulled (`synced_at` cursor). The match screen never waits on the network. The status shows in the side menu.
- **Permissions** are enforced by Postgres row-level security, not just the UI:
  - Coach: only their team(s).
  - Head Coach / Coordinator: assigned teams or age groups.
  - Club Admin: sees all teams and club-wide reports and manages teams, rosters and invites, but **cannot create or edit matches**.
  - Only Club Admins can edit rosters.
  - The audit log is insert-only.

---

## 5. Reports

Menu → Reports. Columns: **Player, Team, Called Up, Starts, Appearances, Minutes, Available Minutes, % Played**. *Available minutes* = the full length of every match the player was called up for.

Scopes: one match, one player, one team, a date range, and (Club Admin) the whole club/season. Coaches can only pick their own teams. The .xlsx also has an **Intervals** sheet with every ON/OFF for audit. A single match can also be exported from its summary.

---

## 6. Development

```bash
npm test            # unit tests: timing engine, reports, sync mapping
npm run test:e2e    # Playwright: full match, reload mid-match, undo, correction, xlsx, roles, practice, offline
npm run typecheck
npm run build       # PWA in dist/ (service worker precaches everything for offline)
npm run seed:sql    # regenerate supabase/seed.sql from src/data/seed.ts
```

Layout:
```
src/domain/     pure logic: types, clock engine, access rules, report aggregation
src/data/       IndexedDB (Dexie), match repository, practice store, sync, session, seed
src/native/     lock-screen bridge (Capacitor plugin + web fallbacks)
src/reports/    .xlsx export (ExcelJS, lazy-loaded)
src/ui/         React screens
ios/ android/   Capacitor native projects incl. Live Activity / foreground service
supabase/       schema + RLS, seed, invite Edge Function
```
