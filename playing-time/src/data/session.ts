// Who is using the app. Two modes:
//  - "cloud": Supabase is configured (VITE_SUPABASE_URL/KEY); login by emailed magic link / invitation.
//  - "demo":  no backend configured; pick one of the seeded Melita FC users. Everything stays on the device.
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from './db';
import { isSeeded, seedDemo } from './seed';
import { startSync } from './sync';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_KEY);

const USER_KEY = 'pt-user-id';
let supabase: SupabaseClient | null = null;

export async function getSupabase(): Promise<SupabaseClient | null> {
  if (!cloudEnabled) return null;
  if (!supabase) {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return supabase;
}

/** Restore the signed-in user (works offline: the id is cached locally). */
export async function boot(): Promise<string | null> {
  if (!cloudEnabled) {
    if (!(await isSeeded())) await seedDemo();
    return localStorage.getItem(USER_KEY);
  }
  const sb = await getSupabase();
  const { data } = await sb!.auth.getSession();
  const id = data.session?.user.id ?? localStorage.getItem(USER_KEY);
  if (data.session) {
    localStorage.setItem(USER_KEY, data.session.user.id);
    startSync(sb!);
  }
  return id;
}

export function setDemoUser(id: string | null) {
  if (id) localStorage.setItem(USER_KEY, id);
  else localStorage.removeItem(USER_KEY);
}

export async function sendMagicLink(email: string) {
  const sb = await getSupabase();
  const { error } = await sb!.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  localStorage.removeItem(USER_KEY);
  const sb = await getSupabase();
  if (sb) await sb.auth.signOut();
}

/** Club Admin invites a coach. In cloud mode an Edge Function sends the email. */
export async function sendInviteEmail(invitationId: string) {
  const sb = await getSupabase();
  if (!sb) return { sent: false as const, reason: 'demo' };
  const { error } = await sb.functions.invoke('invite-coach', { body: { invitationId } });
  if (error) throw error;
  return { sent: true as const };
}

export async function demoUsers() {
  const [users, memberships] = await Promise.all([db.users.toArray(), db.memberships.toArray()]);
  return users.map((u) => ({ user: u, membership: memberships.find((m) => m.userId === u.id) }));
}
