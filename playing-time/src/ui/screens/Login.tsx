import { useState } from 'react';
import { ROLE_LABEL } from '../../domain/access';
import { cloudEnabled, demoUsers, sendMagicLink } from '../../data/session';
import { useLive } from '../hooks';

export function Login({ onDemoLogin }: { onDemoLogin: (userId: string) => void }) {
  const users = useLive(() => demoUsers(), []);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  return (
    <div className="page login">
      <img src="./icon.svg" alt="" width={72} height={72} />
      <h1>Player's Playing Time</h1>
      <p className="muted">Fair minutes for every player.</p>

      {cloudEnabled ? (
        sent ? (
          <p className="card">Check your inbox – we sent a sign-in link to <strong>{email}</strong>.</p>
        ) : (
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr('');
              try {
                await sendMagicLink(email.trim());
                setSent(true);
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            <label>
              Email
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn primary big">Email me a sign-in link</button>
            {err && <p className="error">{err}</p>}
            <p className="muted small">Coaches are invited by their Club Admin.</p>
          </form>
        )
      ) : (
        <div className="card stack">
          <p className="small muted">
            Demo mode – no server configured. Data stays on this device. Pick a Melita FC user:
          </p>
          {users?.map(({ user, membership }) => (
            <button key={user.id} className="btn big choice" onClick={() => onDemoLogin(user.id)}>
              <strong>{user.name}</strong>
              <span className="small">{membership ? ROLE_LABEL[membership.role] : 'No role'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
