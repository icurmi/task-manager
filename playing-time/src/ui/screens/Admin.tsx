import { useState } from 'react';
import { canManageClub, ROLE_LABEL } from '../../domain/access';
import type { Membership, Player, Role, Team } from '../../domain/types';
import { db, put, uid } from '../../data/db';
import { cloudEnabled, sendInviteEmail } from '../../data/session';
import { syncNow } from '../../data/sync';
import { useApp } from '../AppContext';
import { go, useLive } from '../hooks';
import { Shell } from '../Shell';
import { sortPlayers } from './NewMatch';

export function Admin({ tab }: { tab?: string }) {
  const app = useApp();
  if (!canManageClub(app.membership)) return <Shell title="Admin"><p>Only Club Admins can manage the club.</p></Shell>;
  return tab === 'people' ? <People /> : <Teams />;
}

function Teams() {
  const app = useApp();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState('');
  const team = app.teams.find((t) => t.id === teamId);
  if (team) return <Roster team={team} onBack={() => setTeamId(null)} />;

  return (
    <Shell title="Teams & rosters">
      <ul className="list">
        {app.teams.map((t) => (
          <li key={t.id}><button className="list-row" onClick={() => setTeamId(t.id)}><strong>{t.name}</strong><span className="muted">Roster ›</span></button></li>
        ))}
      </ul>
      <form className="row gap" onSubmit={async (e) => {
        e.preventDefault();
        const name = newTeam.trim();
        if (!name) return;
        const t: Team = { id: uid(), updatedAt: 0, clubId: app.club.id, name, ageGroup: name.match(/U\d+/i)?.[0].toUpperCase() ?? name };
        await put('teams', t);
        setNewTeam('');
      }}>
        <input className="grow" placeholder="New team, e.g. U15" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
        <button className="btn primary">Add team</button>
      </form>
    </Shell>
  );
}

function Roster({ team, onBack }: { team: Team; onBack: () => void }) {
  const app = useApp();
  const players = useLive(async () => (await db.players.where('teamId').equals(team.id).toArray()).filter((p) => !p.deleted).sort(sortPlayers), [team.id]);
  const [edit, setEdit] = useState<Partial<Player> | null>(null);

  const save = async () => {
    if (!edit?.lastName?.trim()) return;
    const p: Player = {
      id: edit.id ?? uid(), updatedAt: 0, clubId: app.club.id, teamId: team.id,
      firstName: edit.firstName?.trim() ?? '', lastName: edit.lastName.trim(),
      shirtNumber: edit.shirtNumber ?? null, active: edit.active ?? true,
    };
    await put('players', p);
    setEdit(null);
  };

  return (
    <Shell title={`${team.name} roster`}>
      <button className="btn small" onClick={onBack}>‹ All teams</button>
      <ul className="list">
        {players?.map((p) => (
          <li key={p.id}>
            <button className={`list-row ${p.active ? '' : 'inactive'}`} onClick={() => setEdit(p)}>
              <span><span className="num">{p.shirtNumber ?? '–'}</span> {p.firstName} <strong>{p.lastName}</strong></span>
              {!p.active && <span className="muted small">inactive</span>}
            </button>
          </li>
        ))}
      </ul>
      <button className="btn primary big" onClick={() => setEdit({ active: true })}>+ Add player</button>

      {edit && (
        <div className="modal-backdrop">
          <form className="modal stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <h2>{edit.id ? 'Edit player' : 'New player'}</h2>
            <label>First name<input value={edit.firstName ?? ''} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></label>
            <label>Surname<input required value={edit.lastName ?? ''} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} /></label>
            <label>Shirt number<input inputMode="numeric" value={edit.shirtNumber ?? ''} onChange={(e) => setEdit({ ...edit, shirtNumber: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} /></label>
            <label className="row gap"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (shows in match selection)</label>
            <div className="row gap">
              <button type="button" className="btn big" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary big grow">Save</button>
            </div>
          </form>
        </div>
      )}
    </Shell>
  );
}

function People() {
  const app = useApp();
  const data = useLive(async () => {
    const [memberships, users, invitations] = await Promise.all([
      db.memberships.where('clubId').equals(app.club.id).toArray(),
      db.users.toArray(),
      db.invitations.where('clubId').equals(app.club.id).toArray(),
    ]);
    return { memberships: memberships.filter((m) => !m.deleted), users, invitations: invitations.filter((i) => !i.deleted && !i.acceptedAt) };
  }, [app.club.id]);
  const [form, setForm] = useState<{ email: string; role: Role; teamIds: string[]; ageGroups: string[] }>({ email: '', role: 'coach', teamIds: [], ageGroups: [] });
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<Membership | null>(null);
  const ageGroups = [...new Set(app.teams.map((t) => t.ageGroup))];

  const invite = async () => {
    const email = form.email.trim().toLowerCase();
    if (!email) return;
    const inv = { id: uid(), updatedAt: 0, clubId: app.club.id, email, role: form.role, teamIds: form.teamIds, ageGroups: form.ageGroups, invitedBy: app.user.id };
    await put('invitations', inv);
    if (cloudEnabled) {
      await syncNow();
      try {
        await sendInviteEmail(inv.id);
        setMsg(`Invitation emailed to ${email}.`);
      } catch (e) {
        setMsg(`Saved. The email will be sent when you're online (${(e as Error).message}).`);
      }
    } else {
      // Demo: accept immediately so you can sign in as the new coach.
      const userId = uid();
      await put('users', { id: userId, updatedAt: 0, email, name: email.split('@')[0] });
      await put('memberships', { id: uid(), updatedAt: 0, clubId: app.club.id, userId, role: inv.role, teamIds: inv.teamIds, ageGroups: inv.ageGroups });
      await put('invitations', { ...inv, acceptedAt: Date.now() });
      setMsg(`Demo mode: ${email} added. Sign out to log in as them.`);
    }
    setForm({ email: '', role: 'coach', teamIds: [], ageGroups: [] });
  };

  const access = (m: { role: Role; teamIds: string[]; ageGroups: string[] }) =>
    m.role === 'club_admin' ? 'All teams' :
      [...m.teamIds.map((id) => app.teams.find((t) => t.id === id)?.name ?? '?'), ...m.ageGroups.map((a) => `${a} (age group)`)].join(', ') || 'No teams';

  return (
    <Shell title="Coaches & invites">
      <ul className="list">
        {data?.memberships.map((m) => {
          const u = data.users.find((x) => x.id === m.userId);
          return (
            <li key={m.id}>
              <button className="list-row" onClick={() => setEditing(m)}>
                <span><strong>{u?.name ?? u?.email ?? m.userId}</strong><span className="muted small block">{ROLE_LABEL[m.role]} · {access(m)}</span></span>
                <span className="muted">Edit ›</span>
              </button>
            </li>
          );
        })}
        {data?.invitations.map((i) => (
          <li key={i.id} className="list-row static">
            <span><strong>{i.email}</strong><span className="muted small block">Invited · {ROLE_LABEL[i.role]} · {access(i)}</span></span>
          </li>
        ))}
      </ul>

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); void invite(); }}>
        <h3>Invite by email</h3>
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <AccessPicker value={form} onChange={(v) => setForm({ ...form, ...v })} ageGroups={ageGroups} />
        <button className="btn primary big">Send invitation</button>
        {msg && <p className="small">{msg}</p>}
      </form>

      {editing && (
        <div className="modal-backdrop">
          <div className="modal stack">
            <h2>Access</h2>
            <AccessPicker value={editing} onChange={(v) => setEditing({ ...editing, ...v })} ageGroups={ageGroups} />
            <div className="row gap">
              <button className="btn big" onClick={() => setEditing(null)}>Cancel</button>
              {editing.userId !== app.user.id && (
                <button className="btn big danger" onClick={async () => { await put('memberships', { ...editing, deleted: true }); setEditing(null); }}>Remove</button>
              )}
              <button className="btn primary big grow" onClick={async () => { await put('memberships', editing); setEditing(null); }}>Save</button>
            </div>
          </div>
        </div>
      )}
      <button className="btn small" onClick={() => go('admin/teams')}>Manage teams &amp; rosters ›</button>
    </Shell>
  );
}

function AccessPicker({ value, onChange, ageGroups }: {
  value: { role: Role; teamIds: string[]; ageGroups: string[] };
  onChange: (v: Partial<{ role: Role; teamIds: string[]; ageGroups: string[] }>) => void;
  ageGroups: string[];
}) {
  const app = useApp();
  const tog = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  return (
    <>
      <label>
        Role
        <select value={value.role} onChange={(e) => onChange({ role: e.target.value as Role })}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      {value.role !== 'club_admin' && (
        <>
          <div className="small muted">Teams</div>
          <div className="chips">
            {app.teams.map((t) => (
              <button type="button" key={t.id} className={`chip ${value.teamIds.includes(t.id) ? 'on' : ''}`} onClick={() => onChange({ teamIds: tog(value.teamIds, t.id) })}>{t.name}</button>
            ))}
          </div>
          {value.role === 'head_coach' && (
            <>
              <div className="small muted">…or whole age groups (includes future teams)</div>
              <div className="chips">
                {ageGroups.map((a) => (
                  <button type="button" key={a} className={`chip ${value.ageGroups.includes(a) ? 'on' : ''}`} onClick={() => onChange({ ageGroups: tog(value.ageGroups, a) })}>{a}</button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
