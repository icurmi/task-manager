import { useEffect, useState, type ReactNode } from 'react';
import { canManageClub, canRunMatches, ROLE_LABEL } from '../domain/access';
import { onSyncStatus, syncNow, type SyncStatus } from '../data/sync';
import { useApp } from './AppContext';
import { go, useOnline } from './hooks';

/** Chrome for everything *outside* the match screen. */
export function Shell({ title, children, back }: { title: string; children: ReactNode; back?: string }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const [sync, setSync] = useState<SyncStatus>({ state: 'local', pending: 0 });
  useEffect(() => onSyncStatus(setSync), []);

  const nav = (to: string) => {
    setOpen(false);
    go(to);
  };
  return (
    <div className="shell">
      <header className="topbar">
        {back !== undefined ? (
          <button className="icon-btn" aria-label="Back" onClick={() => go(back)}>‹</button>
        ) : (
          <button className="icon-btn" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
        )}
        <h1>{title}</h1>
        <span className={`dot ${online ? 'on' : 'off'}`} title={online ? 'Online' : 'Offline – everything still works'} />
      </header>
      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <strong>{app.user.name}</strong>
              <span className="muted">{ROLE_LABEL[app.membership.role]} · {app.club.name}</span>
            </div>
            {canRunMatches(app.membership) && <button onClick={() => nav('')}>New match</button>}
            <button onClick={() => nav('matches')}>Matches</button>
            <button onClick={() => nav('reports')}>Reports</button>
            {canManageClub(app.membership) && (
              <>
                <button onClick={() => nav('admin/teams')}>Teams &amp; rosters</button>
                <button onClick={() => nav('admin/people')}>Coaches &amp; invites</button>
              </>
            )}
            <div className="drawer-foot">
              <div className="muted small">
                {online ? 'Online' : 'Offline'} · {sync.state === 'local' ? 'Device-only (demo)' : `Sync: ${sync.state}`}
                {sync.pending > 0 && ` · ${sync.pending} change(s) waiting`}
              </div>
              {sync.state !== 'local' && <button onClick={() => void syncNow()}>Sync now</button>}
              <button onClick={app.signOut}>Sign out</button>
            </div>
          </nav>
        </div>
      )}
      <main className="page">{children}</main>
    </div>
  );
}
