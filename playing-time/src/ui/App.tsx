import { App as CapApp } from '@capacitor/app';
import { useEffect, useMemo, useState } from 'react';
import { visibleTeams } from '../domain/access';
import { db } from '../data/db';
import { boot, cloudEnabled, setDemoUser, signOut } from '../data/session';
import { AppContext, type AppCtx } from './AppContext';
import { go, useLive, useRoute } from './hooks';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { NewMatch } from './screens/NewMatch';
import { MatchScreen } from './screens/MatchScreen';
import { Summary } from './screens/Summary';
import { History } from './screens/History';
import { Reports } from './screens/Reports';
import { Admin } from './screens/Admin';
import { isNative } from '../native/matchControl';

export function App() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    boot().then(setUserId);
  }, []);

  // Deep links from the lock screen: playingtime://match/<id>?sub=1
  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener('appUrlOpen', ({ url }) => {
      const m = url.match(/match\/([^?#/]+)(\?.*)?$/);
      if (m) go(`match/${m[1]}${m[2] ?? ''}`);
    });
    return () => void h.then((x) => x.remove());
  }, []);

  const data = useLive(
    async () => {
      if (!userId) return null;
      const user = await db.users.get(userId);
      const membership = (await db.memberships.where('userId').equals(userId).toArray()).find((m) => !m.deleted);
      if (!user || !membership) return { user, membership: undefined, club: undefined, teams: [] };
      const club = await db.clubs.get(membership.clubId);
      const teams = (await db.teams.where('clubId').equals(membership.clubId).toArray()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      return { user, membership, club, teams };
    },
    [userId],
  );

  const ctx: AppCtx | null = useMemo(() => {
    if (!data?.user || !data.membership || !data.club) return null;
    return {
      user: data.user,
      membership: data.membership,
      club: data.club,
      teams: visibleTeams(data.membership, data.teams),
      signOut: async () => {
        await signOut();
        setUserId(null);
        go('', true);
      },
    };
  }, [data]);

  if (userId === undefined) return <div className="splash">Loading…</div>;
  if (!userId)
    return (
      <Login
        onDemoLogin={(id) => {
          setDemoUser(id);
          setUserId(id);
          go('', true);
        }}
      />
    );
  if (data === undefined) return <div className="splash">Loading…</div>;
  if (!ctx)
    return (
      <div className="page center">
        <h2>Waiting for your club access…</h2>
        <p className="muted">
          {cloudEnabled
            ? 'Your account is signed in but no club membership has synced to this device yet. Connect to the internet once, or ask your Club Admin to invite you.'
            : 'This demo user has no membership.'}
        </p>
        <button className="btn" onClick={async () => { await signOut(); setUserId(null); }}>Sign out</button>
      </div>
    );

  return (
    <AppContext.Provider value={ctx}>
      <Router />
    </AppContext.Provider>
  );
}

function Router() {
  const { path, query } = useRoute();
  const [a, b] = path;
  switch (a) {
    case 'new':
      return <NewMatch teamId={b} />;
    case 'match':
      return <MatchScreen matchId={b} openSub={query.get('sub') === '1'} />;
    case 'summary':
      return <Summary matchId={b} />;
    case 'matches':
      return <History />;
    case 'reports':
      return <Reports initialMatch={query.get('match') ?? undefined} initialPlayer={query.get('player') ?? undefined} />;
    case 'admin':
      return <Admin tab={b} />;
    default:
      return <Home />;
  }
}
