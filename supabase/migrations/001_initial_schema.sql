-- Superseded fix, kept as history: an earlier version of this comment
-- pinned this extension to `WITH SCHEMA public`, on the theory that a
-- fresh `db push` connection's search_path didn't include `extensions`.
-- Directly disproven against the real remote production project
-- (rgohuoooujqclcfkoaht): `uuid-ossp` is pre-installed by Supabase's
-- own project bootstrap into the `extensions` schema BEFORE this
-- migration ever runs, so `CREATE EXTENSION IF NOT EXISTS ... WITH
-- SCHEMA public` is a guaranteed no-op there (`IF NOT EXISTS` skips
-- the whole statement, schema clause included, once an extension of
-- that name exists anywhere) — confirmed live: `uuid-ossp` still sits
-- in `extensions`, not `public`, after that fix was in place. Separately
-- confirmed the connecting role's `search_path` genuinely does include
-- `extensions` (`"$user", public, extensions"`), and that running this
-- entire file as one continuous multi-statement session (via
-- `supabase db query --linked --file`, wrapped in a rolled-back
-- transaction — nothing persisted) succeeds end-to-end, including the
-- exact `create table public.pots (... uuid_generate_v4() ...)`
-- statement `db push` fails on. That rules out the SQL, the schema
-- placement, and the role's search_path as the cause — the failure is
-- specific to `supabase db push`'s own migration-execution path, not
-- reproducible via a normal session. Rather than depend on that CLI
-- behavior being search_path-safe, `uuid_generate_v4()` is now called
-- schema-qualified (`extensions.uuid_generate_v4()`, see below) at
-- both call sites, matching the schema this extension is actually
-- installed into on both this project's local dev database and the
-- real hosted project — removing the dependency on search_path/session
-- continuity entirely, regardless of how `db push` executes statements
-- internally.
create extension if not exists "uuid-ossp";
create extension if not exists "pg_cron";
create extension if not exists "pg_trgm";

create type pot_status as enum ('active', 'archived', 'draft');
create type gameweek_status as enum ('upcoming', 'live', 'completed', 'postponed');
create type fixture_status as enum ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'tbd');
create type entry_status as enum ('pending', 'locked', 'void', 'settled');
create type pick_result as enum ('pending', 'winning', 'losing', 'won', 'lost', 'void');
create type sync_status as enum ('running', 'success', 'failed', 'partial');
create type member_role as enum ('admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (length(username) between 3 and 30 and username ~ '^[a-zA-Z0-9_]+$'),
  display_name text not null check (length(display_name) between 1 and 60),
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seasons (
  id bigserial primary key,
  name text not null,
  year_start int not null,
  year_end int not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (year_start, year_end)
);

create unique index idx_seasons_current on public.seasons(is_current) where is_current = true;

create table public.leagues (
  id bigserial primary key,
  name text not null,
  country text not null,
  provider_id text not null,
  provider_name text not null,
  season_id bigint not null references public.seasons(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider_id, provider_name, season_id)
);

create table public.teams (
  id bigserial primary key,
  name text not null,
  short_name text not null,
  crest_url text,
  provider_id text not null,
  provider_name text not null default 'api-football',
  season_id bigint not null references public.seasons(id) on delete cascade,
  league_id bigint not null references public.leagues(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, provider_name, season_id)
);

create index idx_teams_league on public.teams(league_id);
create index idx_teams_season on public.teams(season_id);

create table public.players (
  id bigserial primary key,
  name text not null,
  display_name text not null,
  position text,
  nationality text,
  date_of_birth date,
  photo_url text,
  provider_id text not null,
  provider_name text not null default 'api-football',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, provider_name)
);

create index idx_players_name_trgm on public.players using gin (display_name gin_trgm_ops);

create table public.player_team_history (
  id bigserial primary key,
  player_id bigint not null references public.players(id) on delete cascade,
  team_id bigint not null references public.teams(id) on delete cascade,
  season_id bigint not null references public.seasons(id) on delete cascade,
  shirt_number int,
  is_active boolean not null default true,
  joined_at date,
  left_at date,
  created_at timestamptz not null default now(),
  unique (player_id, team_id, season_id)
);

create index idx_pth_player on public.player_team_history(player_id);
create index idx_pth_team on public.player_team_history(team_id);
create index idx_pth_active on public.player_team_history(is_active) where is_active = true;

create table public.gameweeks (
  id bigserial primary key,
  season_id bigint not null references public.seasons(id) on delete cascade,
  league_id bigint not null references public.leagues(id) on delete cascade,
  number int not null check (number between 1 and 38),
  name text not null,
  status gameweek_status not null default 'upcoming',
  deadline_utc timestamptz,
  earliest_kickoff_utc timestamptz,
  is_current boolean not null default false,
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, league_id, number)
);

create unique index idx_gameweeks_current on public.gameweeks(is_current) where is_current = true;
create index idx_gameweeks_status on public.gameweeks(status);

create table public.fixtures (
  id bigserial primary key,
  gameweek_id bigint not null references public.gameweeks(id) on delete cascade,
  home_team_id bigint not null references public.teams(id),
  away_team_id bigint not null references public.teams(id),
  kickoff_utc timestamptz not null,
  status fixture_status not null default 'scheduled',
  minute int,
  home_goals int not null default 0,
  away_goals int not null default 0,
  provider_id text not null,
  provider_name text not null default 'api-football',
  provider_raw jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, provider_name),
  check (home_team_id <> away_team_id)
);

create index idx_fixtures_gameweek on public.fixtures(gameweek_id);
create index idx_fixtures_kickoff on public.fixtures(kickoff_utc);
create index idx_fixtures_status on public.fixtures(status);

create table public.fixture_events (
  id bigserial primary key,
  fixture_id bigint not null references public.fixtures(id) on delete cascade,
  player_id bigint references public.players(id),
  team_id bigint not null references public.teams(id),
  event_type text not null,
  minute int not null,
  extra_minute int,
  assist_player_id bigint references public.players(id),
  is_own_goal boolean not null default false,
  is_penalty boolean not null default false,
  provider_id text,
  provider_raw jsonb,
  created_at timestamptz not null default now(),
  unique (fixture_id, provider_id)
);

create index idx_fixture_events_fixture on public.fixture_events(fixture_id);
create index idx_fixture_events_player on public.fixture_events(player_id);

create table public.pots (
  id uuid primary key default extensions.uuid_generate_v4(),
  name text not null check (length(name) between 1 and 80),
  description text,
  status pot_status not null default 'active',
  season_id bigint not null references public.seasons(id),
  league_id bigint not null references public.leagues(id),
  created_by uuid not null references public.profiles(id),
  invite_code text unique,
  max_members int check (max_members >= 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pot_members (
  id bigserial primary key,
  pot_id uuid not null references public.pots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  unique (pot_id, user_id)
);

create index idx_pot_members_pot on public.pot_members(pot_id);
create index idx_pot_members_user on public.pot_members(user_id);

create table public.entry_payments (
  id bigserial primary key,
  pot_id uuid not null references public.pots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  gameweek_id bigint not null references public.gameweeks(id) on delete cascade,
  is_paid boolean not null default false,
  marked_by uuid references public.profiles(id),
  marked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pot_id, user_id, gameweek_id)
);

create table public.user_entries (
  id uuid primary key default extensions.uuid_generate_v4(),
  pot_id uuid not null references public.pots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  gameweek_id bigint not null references public.gameweeks(id) on delete cascade,
  status entry_status not null default 'pending',
  picks_won int not null default 0,
  picks_total int not null default 5,
  is_void boolean not null default false,
  submitted_at timestamptz,
  locked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pot_id, user_id, gameweek_id)
);

create index idx_user_entries_pot_gw on public.user_entries(pot_id, gameweek_id);
create index idx_user_entries_user on public.user_entries(user_id);

create table public.user_entry_picks (
  id bigserial primary key,
  entry_id uuid not null references public.user_entries(id) on delete cascade,
  pick_position int not null check (pick_position between 1 and 5),
  player_id bigint not null references public.players(id),
  goal_threshold int not null default 1,
  goals_scored int not null default 0,
  result pick_result not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, pick_position)
);

create index idx_picks_entry on public.user_entry_picks(entry_id);
create index idx_picks_player on public.user_entry_picks(player_id);

create table public.leaderboard_snapshots (
  id bigserial primary key,
  pot_id uuid not null references public.pots(id) on delete cascade,
  gameweek_id bigint references public.gameweeks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null,
  picks_won int not null default 0,
  picks_total int not null default 0,
  entries_count int not null default 0,
  strike_rate numeric(5,2) not null default 0,
  is_overall boolean not null default false,
  is_void boolean not null default false,
  snapshot_at timestamptz not null default now(),
  unique (pot_id, gameweek_id, user_id)
);

create table public.sync_runs (
  id bigserial primary key,
  job_name text not null,
  status sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_processed int not null default 0,
  errors jsonb,
  triggered_by text not null default 'cron',
  triggered_by_user uuid references public.profiles(id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger trg_teams_updated_at before update on public.teams
for each row execute function public.set_updated_at();
create trigger trg_players_updated_at before update on public.players
for each row execute function public.set_updated_at();
create trigger trg_gameweeks_updated_at before update on public.gameweeks
for each row execute function public.set_updated_at();
create trigger trg_fixtures_updated_at before update on public.fixtures
for each row execute function public.set_updated_at();
create trigger trg_pots_updated_at before update on public.pots
for each row execute function public.set_updated_at();
create trigger trg_entry_payments_updated_at before update on public.entry_payments
for each row execute function public.set_updated_at();
create trigger trg_user_entries_updated_at before update on public.user_entries
for each row execute function public.set_updated_at();
create trigger trg_user_entry_picks_updated_at before update on public.user_entry_picks
for each row execute function public.set_updated_at();

create or replace function public.recompute_goal_thresholds()
returns trigger
language plpgsql
as $$
declare
  v_entry_id uuid;
  v_player_id bigint;
begin
  if tg_op = 'DELETE' then
    v_entry_id := old.entry_id;
    v_player_id := old.player_id;
  else
    v_entry_id := new.entry_id;
    v_player_id := new.player_id;
  end if;

  update public.user_entry_picks
  set goal_threshold = (
    select count(*)
    from public.user_entry_picks
    where entry_id = v_entry_id and player_id = v_player_id
  )
  where entry_id = v_entry_id and player_id = v_player_id;

  return coalesce(new, old);
end;
$$;

create trigger trg_goal_thresholds
after insert or delete on public.user_entry_picks
for each row execute function public.recompute_goal_thresholds();

create or replace function public.create_entry_payment()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.entry_payments (pot_id, user_id, gameweek_id, is_paid)
  values (new.pot_id, new.user_id, new.gameweek_id, false)
  on conflict (pot_id, user_id, gameweek_id) do nothing;
  return new;
end;
$$;

create trigger trg_create_entry_payment
after insert on public.user_entries
for each row execute function public.create_entry_payment();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_new_user
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace view public.available_players_by_gameweek as
select distinct
  p.id as player_id,
  p.display_name,
  p.position,
  p.photo_url,
  t.id as team_id,
  t.name as team_name,
  t.short_name as team_short_name,
  t.crest_url,
  gw.id as gameweek_id,
  gw.number as gameweek_number
from public.players p
join public.player_team_history pth on pth.player_id = p.id and pth.is_active = true
join public.teams t on t.id = pth.team_id
join public.fixtures f on (f.home_team_id = t.id or f.away_team_id = t.id)
join public.gameweeks gw on gw.id = f.gameweek_id
where f.status not in ('postponed', 'cancelled');

create materialized view public.player_fixture_goals as
select
  fe.player_id,
  fe.fixture_id,
  f.gameweek_id,
  count(*) filter (
    where fe.event_type in ('goal', 'penalty') and not fe.is_own_goal
  ) as goals
from public.fixture_events fe
join public.fixtures f on f.id = fe.fixture_id
where fe.event_type in ('goal', 'penalty')
  and not fe.is_own_goal
  and fe.player_id is not null
group by fe.player_id, fe.fixture_id, f.gameweek_id;

create unique index idx_pfg_player_fixture on public.player_fixture_goals(player_id, fixture_id);
create index idx_pfg_gameweek on public.player_fixture_goals(gameweek_id);

create or replace function public.refresh_player_fixture_goals()
returns void
language plpgsql
as $$
begin
  refresh materialized view concurrently public.player_fixture_goals;
exception
  when feature_not_supported then
    refresh materialized view public.player_fixture_goals;
end;
$$;