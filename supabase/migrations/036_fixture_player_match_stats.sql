-- Phase 25 (review pass) — Opta-style player statistics. Found live while
-- reviewing item 19 (Standings/Statistics page): a real WhoScored match
-- page's own `matchCentreData` (same URL pattern `ws-live-events.js`
-- already fetches every scrape cycle — this is not a new data source, no
-- new provider) carries a full per-player `stats` object per minute —
-- ratings, shots, passes, tackles, aerials, dribbles, fouls, GK saves —
-- entirely discarded today because `ws-live-events.js`'s own `parseEvents()`
-- only ever reads `matchData.incidentEvents`. This table is where the rest
-- of that already-fetched payload finally goes.
--
-- One row per (fixture_id, player_id) — a single match's final/latest
-- stat line for one player, not a per-minute timeseries (WhoScored's own
-- per-minute breakdown is a live-progress mechanism; only the final value
-- — the value at the highest minute key — is meaningful once stored).
-- Column set maps directly onto item 19's own requested Opta categories
-- (Attacking/Passing/Discipline/Defending/Goalkeeping/Rating); anything
-- WhoScored exposes beyond that named set is kept in `raw_stats` rather
-- than either dropped or turned into more speculative typed columns —
-- same "keep the raw payload, extract what's actually needed" pattern
-- `fixture_events.provider_raw` already established for incident events.
--
-- Deliberately does NOT duplicate fixture_player_status (started/bench/
-- sub_on/sub_off/came_on_minute/went_off_minute) — that's a separate,
-- already-designed mechanism for lineup/appearance tracking (ISSUE-2,
-- still an empty table in every environment today); `is_first_eleven`/
-- `is_man_of_the_match` are stored here only because they're two more
-- plain fields already on the same scraped player object, not an attempt
-- to backfill that other table's gap.
create table public.fixture_player_match_stats (
  id bigint generated always as identity primary key,
  fixture_id bigint not null references public.fixtures(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  team_id bigint not null references public.teams(id) on delete cascade,

  rating numeric(4,2),
  is_first_eleven boolean not null default false,
  is_man_of_the_match boolean not null default false,

  -- Attacking
  shots_total int,
  shots_on_target int,
  shots_off_target int,
  shots_blocked int,
  key_passes int,
  dribbles_won int,
  dribbles_attempted int,
  dribble_success numeric(5,2),
  dispossessed int,

  -- Passing
  passes_total int,
  passes_accurate int,
  pass_success numeric(5,2),

  -- Discipline (yellow/red already come from fixture_events — never
  -- duplicated here)
  fouls_committed int,
  -- WhoScored's own field name; direction (given vs suffered) not
  -- independently confirmed against a match with a real offside — stored
  -- under its source name rather than guessed/renamed.
  offsides_caught int,

  -- Defending
  tackles_total int,
  tackles_won int,
  tackle_success numeric(5,2),
  interceptions int,
  clearances int,
  dribbled_past int,
  aerials_total int,
  aerials_won int,
  aerial_success numeric(5,2),
  touches int,
  errors int,

  -- Goalkeeping
  total_saves int,
  parried_safe int,
  parried_danger int,

  raw_stats jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),

  unique (fixture_id, player_id)
);

comment on table public.fixture_player_match_stats is
  'Phase 25 (review pass) — one row per (fixture_id, player_id): that match''s final WhoScored per-player stat line (ratings/shots/passes/tackles/aerials/GK saves). Written only by ws-live-events.js (service role) — no client-reachable write policy, same reasoning as fixture_events. raw_stats preserves the full scraped stats object; typed columns above are the subset item 19''s Opta-style categories actually need.';

create index idx_fixture_player_match_stats_fixture on public.fixture_player_match_stats (fixture_id);
create index idx_fixture_player_match_stats_player on public.fixture_player_match_stats (player_id);

alter table public.fixture_player_match_stats enable row level security;

-- Same "reference_data_read_*" shape every other reference/reference-like
-- table already uses (002_rls_policies.sql) — readable by any
-- authenticated user, no pot-membership gate (this is match data, not a
-- pot secret).
create policy "reference_data_read_fixture_player_match_stats"
on public.fixture_player_match_stats for select to authenticated using (true);

-- Season-level aggregate, the exact same shape/reasoning as
-- player_season_stats (025_match_centre_views.sql): a plain view, not
-- materialized (that project already has one materialized view,
-- player_fixture_goals, that silently goes stale because nothing
-- refreshes it — ISSUE-3 — deliberately not repeating that bug class).
-- Percentages are recomputed from summed totals (accurate/total*100),
-- never averaged across matches — averaging per-match percentages would
-- silently misweight a player's one 2-minute cameo the same as their
-- full 90 minutes elsewhere.
create or replace view public.player_season_match_stats as
select
  fs.player_id,
  gw.season_id,
  count(*) as matches_with_stats,
  round(avg(fs.rating), 2) as avg_rating,
  sum(fs.shots_total) as shots_total,
  sum(fs.shots_on_target) as shots_on_target,
  sum(fs.shots_off_target) as shots_off_target,
  sum(fs.key_passes) as key_passes,
  sum(fs.dribbles_won) as dribbles_won,
  sum(fs.dribbles_attempted) as dribbles_attempted,
  sum(fs.passes_total) as passes_total,
  sum(fs.passes_accurate) as passes_accurate,
  case when sum(fs.passes_total) > 0
    then round(100.0 * sum(fs.passes_accurate) / sum(fs.passes_total), 2)
    else null end as pass_success,
  sum(fs.fouls_committed) as fouls_committed,
  sum(fs.offsides_caught) as offsides_caught,
  sum(fs.tackles_total) as tackles_total,
  sum(fs.tackles_won) as tackles_won,
  sum(fs.interceptions) as interceptions,
  sum(fs.clearances) as clearances,
  sum(fs.dribbled_past) as dribbled_past,
  sum(fs.aerials_total) as aerials_total,
  sum(fs.aerials_won) as aerials_won,
  sum(fs.touches) as touches,
  sum(fs.total_saves) as total_saves,
  sum(fs.man_of_the_match_count) as man_of_the_match_count
from (
  select
    fixture_id, player_id, rating, shots_total, shots_on_target, shots_off_target,
    key_passes, dribbles_won, dribbles_attempted, passes_total, passes_accurate,
    fouls_committed, offsides_caught, tackles_total, tackles_won, interceptions,
    clearances, dribbled_past, aerials_total, aerials_won, touches, total_saves,
    case when is_man_of_the_match then 1 else 0 end as man_of_the_match_count
  from public.fixture_player_match_stats
) fs
join public.fixtures f on f.id = fs.fixture_id
join public.gameweeks gw on gw.id = f.gameweek_id
group by fs.player_id, gw.season_id;

comment on view public.player_season_match_stats is
  'Phase 25 (review pass) — season-level Opta-style aggregate over fixture_player_match_stats. avg_rating is a plain mean across matches with a recorded rating; pass_success is recomputed from summed totals, never averaged per-match. Empty (zero rows) in any environment where ws-live-events.js has not yet run against a live/finished fixture — the same "genuinely no data yet, not a bug" state player_season_stats itself can be in before any goals are scored.';
