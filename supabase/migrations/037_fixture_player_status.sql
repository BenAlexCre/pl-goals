-- Phase 25 (lineup status) — `fixture_player_status` has existed on this
-- project's own live database since early on (frontend code has read it
-- for several phases: useEntry.js's useFixturePlayerStatuses,
-- usePredictorEntry.js's useFixturePlayerStatus, useMatchCentre.js's
-- best-effort appearances/starts/minutes) but was never itself captured
-- by a migration — current-state.md ISSUE-2, confirmed via
-- `supabase/migrations/011_realtime_publication.sql`'s own comment
-- explaining why it couldn't be added to the realtime publication there.
-- This migration captures the table AS IT ALREADY LIVES on this project's
-- database (confirmed via the PostgREST OpenAPI schema and live
-- insert/upsert probes — every column, the enum, and the
-- unique(fixture_id, player_id) constraint the upsert strategy below
-- depends on all already exist), the same "match live reality, invent
-- nothing new" approach migration 032 already used for
-- whoscored_fixture_id/stats_status. Safe to replay on this
-- already-drifted database (every statement below is a no-op there) and
-- on a genuinely fresh one (real creates).
--
-- `shots`/`shots_on_target`/`current_rating`/`stats_synced_at` are
-- likewise captured as-is — live, unused by any current application code
-- (confirmed by grep), reads as an earlier, abandoned attempt at
-- per-fixture live stats tracking (the same "scaffolding for a lifecycle
-- that was never finished" class of column migration 032 found on
-- `fixtures`). Not used by this phase's own ingestion (see
-- ws-live-events.js's parseLineup()) and not removed — dropping a column
-- is destructive with no evidence of what may depend on it.

do $$ begin
  create type public.player_match_status as enum ('starting', 'bench', 'sub_on', 'sub_off', 'not_in_squad');
exception when duplicate_object then null;
end $$;

create table if not exists public.fixture_player_status (
  id bigint generated always as identity primary key,
  fixture_id bigint not null references public.fixtures(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  team_id bigint not null references public.teams(id) on delete cascade,
  status public.player_match_status not null,
  started boolean not null default false,
  came_on_minute int,
  went_off_minute int,
  provider_id text,
  provider_raw jsonb,
  shots int,
  shots_on_target int,
  current_rating numeric,
  stats_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fixture_id, player_id)
);

-- Real, live finding (not theoretical): on this project's own database
-- this table was owned by `supabase_admin` (not `postgres`, the role
-- every normal migration — including this one — runs as), the same class
-- of out-of-band-creation issue this project has already hit once before
-- with the retired prototype's supabase_admin-owned predictor_picks table
-- (docs/decisions.md). `postgres` here has rolsuper=false (confirmed via
-- pg_roles — only `supabase_admin` is a true superuser in this image), so
-- ownership genuinely blocks ALTER/CREATE INDEX/POLICY/TRIGGER regardless
-- of role. Fixed with a one-time `alter table ... owner to postgres`
-- (via a supabase_admin session, the only role that could reassign it)
-- BEFORE this migration could run at all — bringing this table in line
-- with every other table in the schema. If this same table exists with
-- the same anomaly on any other deployment of this project, that
-- environment needs the identical one-time ownership fix before this
-- migration will apply there either.
comment on table public.fixture_player_status is
  'GE/Match Centre. One row per (fixture_id, player_id): that player''s lineup classification for this fixture. `status` starting/bench are the STABLE lineup classification (never changed by a substitution); sub_on/sub_off are event-state overlays used by Pick 5''s live pick display (GameweekPage.jsx AppearanceBadge) — `started` (boolean) is what lineup-classification consumers (PlayerCard.jsx, Score Predictor''s goalscorer picker, Match Centre''s Lineups tab) should treat as the durable "was this player in the Starting XI" fact. Written only by ws-live-events.js (service role) once WhoScored publishes official lineups for a fixture — no client-reachable write policy. Phase 25 (lineup status) formalizes this table''s already-live schema into a migration (ISSUE-2) and wires up real ingestion (previously 0 rows in every environment).';

create index if not exists idx_fixture_player_status_fixture on public.fixture_player_status (fixture_id);
create index if not exists idx_fixture_player_status_player on public.fixture_player_status (player_id);

alter table public.fixture_player_status enable row level security;

drop policy if exists "reference_data_read_fixture_player_status" on public.fixture_player_status;
create policy "reference_data_read_fixture_player_status"
on public.fixture_player_status for select to authenticated using (true);

do $$ begin
  create trigger trg_fixture_player_status_updated_at
  before update on public.fixture_player_status
  for each row execute function public.set_updated_at();
exception when duplicate_object then null;
end $$;

-- Finishes migration 011's own deferred TODO ("add it once ISSUE-2 gives
-- that table a proper migration of its own") — useLiveScores.js already
-- subscribes to this table's postgres_changes; that subscription has been
-- silently inert until now for the same reason 011 explains for
-- fixture_events/fixtures/pick5_picks.
do $$ begin
  alter publication supabase_realtime add table public.fixture_player_status;
exception when duplicate_object then null;
end $$;
