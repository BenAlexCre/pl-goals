-- Phase 8C, Slice 1 — Demo Centre & Demo Gameweek.
--
-- Two new, purely additive tables plus one new column on an existing table.
-- No existing table's shape, constraint, or RLS policy is changed.
--
-- demo_sessions/demo_timeline_events are pure platform-admin tooling: no
-- "own row" concept applies (unlike every other table in this schema, which
-- is owned by a user or scoped to a pot a user belongs to), so each gets a
-- single is_app_admin()-gated policy per operation, matching the existing
-- sync_runs_select_admin pattern (002_rls_policies.sql) rather than
-- inventing a new authorization shape.
--
-- Isolation of the demo football data itself needs no new columns at all:
-- teams/gameweeks already carry league_id/season_id directly, and pots
-- already carries league_id/season_id — a single dedicated "Demo Premier
-- League" league + season (created by demo-generate-data, not by this
-- migration) is sufficient to scope every demo team/player-link/gameweek/
-- fixture/pot. The one genuinely new per-row marker is profiles.is_demo,
-- since users aren't scoped by league/season at all.

create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  gameweek_status text not null default 'not_started'
    check (gameweek_status in ('not_started', 'running', 'paused', 'stopped', 'completed')),
  league_id bigint references public.leagues(id),
  season_id bigint references public.seasons(id),
  gameweek_id bigint references public.gameweeks(id),
  created_by uuid references auth.users(id),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.demo_sessions is
  'Phase 8C — one row per generated demo environment. status tracks whether demo data exists at all (draft/active/archived); gameweek_status tracks the live one-hour Demo Gameweek playback head, independent of status. config is audit/debug metadata only (user count, generated pot ids) — never load-bearing for cleanup, which is always driven by league_id/season_id/profiles.is_demo.';
comment on column public.demo_sessions.gameweek_id is
  'The one demo gameweek exposed to the interactive Demo Gameweek controls (Start/Pause/Trigger next event/etc). Other demo gameweeks generated for history are settled instantly at generation time and never referenced here.';

create table public.demo_timeline_events (
  id uuid primary key default gen_random_uuid(),
  demo_session_id uuid not null references public.demo_sessions(id) on delete cascade,
  fixture_id bigint not null references public.fixtures(id) on delete cascade,
  sequence_order int not null,
  minute int not null,
  event_type text not null check (event_type in (
    'kickoff', 'goal', 'own_goal', 'penalty_goal', 'missed_penalty',
    'yellow_card', 'red_card', 'second_yellow', 'sub_on', 'sub_off',
    'var_review', 'injury', 'full_time'
  )),
  team_id bigint references public.teams(id),
  player_id bigint references public.players(id),
  assist_player_id bigint references public.players(id),
  fired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (demo_session_id, sequence_order)
);

comment on table public.demo_timeline_events is
  'Phase 8C — the pre-generated, replayable event script for one Demo Gameweek, one row per planned moment across every fixture in it. demo-gameweek-control pops rows here in sequence_order and translates goal/own_goal/penalty_goal into real fixture_events rows (event_type=''goal'' + is_own_goal/is_penalty flags) plus a fixtures.home_goals/away_goals increment, matching the real schema exactly. var_review/injury are real, admin-labelled event types added for this demo purpose (see FixtureEventsTimeline.jsx) — the project''s "never fabricate data for real fixtures" rule does not apply to a session the operator explicitly generated as synthetic.';
comment on column public.demo_timeline_events.fired_at is
  'null = not yet applied. Set once demo-gameweek-control has written the corresponding fixture_events/fixtures update for this moment.';

alter table public.profiles
  add column is_demo boolean not null default false;

comment on column public.profiles.is_demo is
  'Phase 8C — marks synthetic users created by demo-generate-data (email domain @example.test, RFC 2606 reserved-for-testing, never deliverable). Purely a cleanup/search marker with no authorization meaning; only ever written by the service-role demo Edge Functions in practice.';

alter table public.demo_sessions enable row level security;
alter table public.demo_timeline_events enable row level security;

create policy "demo_sessions_select_admin"
on public.demo_sessions for select
to authenticated
using (public.is_app_admin());

create policy "demo_sessions_insert_admin"
on public.demo_sessions for insert
to authenticated
with check (public.is_app_admin());

create policy "demo_sessions_update_admin"
on public.demo_sessions for update
to authenticated
using (public.is_app_admin());

create policy "demo_sessions_delete_admin"
on public.demo_sessions for delete
to authenticated
using (public.is_app_admin());

create policy "demo_timeline_events_select_admin"
on public.demo_timeline_events for select
to authenticated
using (public.is_app_admin());

create policy "demo_timeline_events_insert_admin"
on public.demo_timeline_events for insert
to authenticated
with check (public.is_app_admin());

create policy "demo_timeline_events_update_admin"
on public.demo_timeline_events for update
to authenticated
using (public.is_app_admin());

create policy "demo_timeline_events_delete_admin"
on public.demo_timeline_events for delete
to authenticated
using (public.is_app_admin());

-- Closes the LMS/Predictor live-standings gap identified while planning this
-- slice: fixtures/fixture_events are already in this publication (011) and
-- already drive useLiveScores.js's invalidation, but pot_standings_snapshots
-- (what LmsEngine/PredictorEngine's generateStandings() writes) was never
-- added, so a Demo Gameweek elimination/leaderboard change — or any real one
-- — would never appear live without a manual refetch.
alter publication supabase_realtime add table public.pot_standings_snapshots;
