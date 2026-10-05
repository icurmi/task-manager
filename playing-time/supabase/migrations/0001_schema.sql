-- Player's Playing Time – server schema (Supabase / Postgres).
-- Platform → Club → Teams → Coaches → Players.
-- Clients are offline-first: they generate ids, write locally, and upsert here when online.
-- `updated_at` is the client's epoch-ms write time; `synced_at` is set by the server and drives pulls.

create table clubs (
  id text primary key,
  name text not null,
  short_name text not null,
  country text,
  season text,
  sport_config jsonb not null default '{"playersOnField":11,"substitutedCanReturn":true}',
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table teams (
  id text primary key,
  club_id text not null references clubs(id),
  name text not null,
  age_group text not null,
  sport_config jsonb,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table players (
  id text primary key,
  club_id text not null references clubs(id),
  team_id text not null references teams(id),
  first_name text not null default '',
  last_name text not null,
  shirt_number int,
  active boolean not null default true,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table profiles (
  id text primary key, -- = auth.users.id
  email text not null,
  name text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table memberships (
  id text primary key,
  club_id text not null references clubs(id),
  user_id text not null references profiles(id),
  role text not null check (role in ('coach','head_coach','club_admin')),
  team_ids text[] not null default '{}',
  age_groups text[] not null default '{}',
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table invitations (
  id text primary key,
  club_id text not null references clubs(id),
  email text not null,
  role text not null check (role in ('coach','head_coach','club_admin')),
  team_ids text[] not null default '{}',
  age_groups text[] not null default '{}',
  invited_by text not null,
  accepted_at bigint,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table matches (
  id text primary key,
  club_id text not null references clubs(id),
  team_id text not null references teams(id),
  opponent text not null default '',
  created_by text not null,
  created_at bigint not null,
  status text not null check (status in ('live','finished')),
  sport_config jsonb not null,
  kickoff_at bigint,
  ended_at bigint,
  duration_ms bigint,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table match_selections (
  id text primary key,
  club_id text not null references clubs(id),
  match_id text not null references matches(id),
  player_id text not null references players(id),
  starting boolean not null default false,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

-- Raw timestamped event log (START / PERIOD / SUB / END). Undo = soft delete.
create table match_events (
  id text primary key,
  club_id text not null references clubs(id),
  match_id text not null references matches(id),
  seq int not null,
  type text not null check (type in ('start','period','sub','end')),
  at bigint not null,
  off_id text,
  on_id text,
  source text,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table periods (
  id text primary key,
  club_id text not null references clubs(id),
  match_id text not null references matches(id),
  number int not null,
  started_at bigint not null,
  ended_at bigint not null,
  clock_start_ms bigint not null,
  clock_end_ms bigint not null,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

-- Every ON/OFF stretch per player, in match-clock ms.
create table playing_intervals (
  id text primary key,
  club_id text not null references clubs(id),
  match_id text not null references matches(id),
  player_id text not null references players(id),
  on_ms bigint not null,
  off_ms bigint not null check (off_ms > on_ms),
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

-- Append-only log of post-match corrections.
create table audit_log (
  id text primary key,
  club_id text not null references clubs(id),
  match_id text not null references matches(id),
  user_id text not null,
  user_name text not null,
  at bigint not null,
  player_id text not null,
  action text not null check (action in ('add','edit','delete')),
  before jsonb,
  after jsonb,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create index on teams (club_id);
create index on players (team_id);
create index on memberships (user_id);
create index on matches (team_id);
create index on match_selections (match_id);
create index on match_events (match_id);
create index on periods (match_id);
create index on playing_intervals (match_id);
create index on audit_log (match_id);

-- synced_at always = server time of last write (pull cursor).
create function touch_synced_at() returns trigger language plpgsql as $$
begin new.synced_at := clock_timestamp(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['clubs','teams','players','profiles','memberships','invitations','matches',
    'match_selections','match_events','periods','playing_intervals','audit_log'] loop
    execute format('create trigger touch before insert or update on %I for each row execute function touch_synced_at()', t);
    execute format('create index on %I (synced_at)', t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------- access helpers ----------
create function my_memberships() returns setof memberships
language sql stable security definer set search_path = public as $$
  select * from memberships where user_id = auth.uid()::text and not deleted
$$;

create function is_member(c text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from my_memberships() m where m.club_id = c)
$$;

create function is_club_admin(c text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from my_memberships() m where m.club_id = c and m.role = 'club_admin')
$$;

-- Coach: own teams. Head coach: assigned teams or age groups. Club admin: all teams.
create function can_see_team(t text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teams tm join my_memberships() m on m.club_id = tm.club_id
    where tm.id = t and (m.role = 'club_admin' or tm.id = any(m.team_ids) or tm.age_group = any(m.age_groups))
  )
$$;

-- Running / correcting matches: coaches and head coaches only (Club Admin has no part in matches).
create function can_run_team(t text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teams tm join my_memberships() m on m.club_id = tm.club_id
    where tm.id = t and m.role <> 'club_admin' and (tm.id = any(m.team_ids) or tm.age_group = any(m.age_groups))
  )
$$;

create function can_see_match(mid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from matches where id = mid and can_see_team(team_id))
$$;
create function can_run_match(mid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from matches where id = mid and can_run_team(team_id))
$$;

-- ---------- policies ----------
create policy read on clubs for select using (is_member(id));
create policy write on clubs for update using (is_club_admin(id));

create policy read on teams for select using (can_see_team(id));
create policy ins on teams for insert with check (is_club_admin(club_id));
create policy upd on teams for update using (is_club_admin(club_id));

create policy read on players for select using (can_see_team(team_id));
create policy ins on players for insert with check (is_club_admin(club_id));
create policy upd on players for update using (is_club_admin(club_id));

create policy read on profiles for select using (
  id = auth.uid()::text or exists (select 1 from memberships m where m.user_id = profiles.id and is_club_admin(m.club_id)));
create policy ins on profiles for insert with check (id = auth.uid()::text);
create policy upd on profiles for update using (id = auth.uid()::text);

create policy read on memberships for select using (user_id = auth.uid()::text or is_club_admin(club_id));
create policy ins on memberships for insert with check (is_club_admin(club_id));
create policy upd on memberships for update using (is_club_admin(club_id));

create policy all_admin on invitations for all using (is_club_admin(club_id)) with check (is_club_admin(club_id));

create policy read on matches for select using (can_see_team(team_id));
create policy ins on matches for insert with check (can_run_team(team_id));
create policy upd on matches for update using (can_run_team(team_id));

do $$ declare t text; begin
  foreach t in array array['match_selections','match_events','periods','playing_intervals'] loop
    execute format('create policy read on %I for select using (can_see_match(match_id))', t);
    execute format('create policy ins on %I for insert with check (can_run_match(match_id))', t);
    execute format('create policy upd on %I for update using (can_run_match(match_id))', t);
  end loop;
end $$;

create policy read on audit_log for select using (can_see_match(match_id));
create policy ins on audit_log for insert with check (can_run_match(match_id) and user_id = auth.uid()::text);
-- no update/delete policy: audit log is append-only

-- ---------- invitations → membership on first sign-in ----------
create function accept_invitations() returns trigger language plpgsql security definer set search_path = public as $$
declare inv invitations;
begin
  insert into profiles (id, email, name, updated_at)
    values (new.id::text, new.email, split_part(new.email, '@', 1), (extract(epoch from now()) * 1000)::bigint)
    on conflict (id) do nothing;
  for inv in select * from invitations where lower(email) = lower(new.email) and accepted_at is null and not deleted loop
    insert into memberships (id, club_id, user_id, role, team_ids, age_groups, updated_at)
      values (gen_random_uuid()::text, inv.club_id, new.id::text, inv.role, inv.team_ids, inv.age_groups,
              (extract(epoch from now()) * 1000)::bigint);
    update invitations set accepted_at = (extract(epoch from now()) * 1000)::bigint where id = inv.id;
  end loop;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function accept_invitations();
