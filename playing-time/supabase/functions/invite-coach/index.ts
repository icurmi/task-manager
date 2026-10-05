// Supabase Edge Function: emails an invitation created by a Club Admin.
// Deploy: supabase functions deploy invite-coach
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const redirectTo = Deno.env.get('APP_URL') ?? undefined;

  const { invitationId } = await req.json();
  // Read the invitation AS THE CALLER: RLS only returns it to a Club Admin of that club.
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: inv, error } = await asCaller.from('invitations').select('*').eq('id', invitationId).single();
  if (error || !inv) return new Response(JSON.stringify({ error: 'Invitation not found or not allowed' }), { status: 403, headers: cors });

  const admin = createClient(url, service);
  const { error: e2 } = await admin.auth.admin.inviteUserByEmail(inv.email, { redirectTo });
  if (e2 && !/already/i.test(e2.message)) {
    return new Response(JSON.stringify({ error: e2.message }), { status: 400, headers: cors });
  }
  // Existing user: attach the membership straight away.
  if (e2) {
    const { data: users } = await admin.auth.admin.listUsers();
    const u = users?.users.find((x) => x.email?.toLowerCase() === inv.email.toLowerCase());
    if (u) {
      await admin.from('memberships').insert({
        id: crypto.randomUUID(), club_id: inv.club_id, user_id: u.id, role: inv.role,
        team_ids: inv.team_ids, age_groups: inv.age_groups, updated_at: Date.now(),
      });
      await admin.from('invitations').update({ accepted_at: Date.now(), updated_at: Date.now() }).eq('id', inv.id);
    }
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
