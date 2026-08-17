-- Phase 8a — Match Centre Core. Two plain (not materialized — the
-- codebase already has one materialized view, player_fixture_goals, that
-- silently goes stale because nothing refreshes it; see
-- docs/current-state.md ISSUE-3 — this deliberately avoids repeating that
-- bug class) read-only views feeding the new Match Centre/Player drawer
-- UI. Neither touches Game Engine tables (game_entries, pick5_picks,
-- pot_prizes, etc.) — both are pure projections over the existing
-- reference-data tables (fixtures, fixture_events, teams), already
-- readable by any authenticated user via the "reference_data_read_*" RLS
-- policies (002_rls_policies.sql) — no new grants/policies needed, same
-- as available_players_by_gameweek (001_initial_schema.sql) needed none.

-- One row per (league_id, season_id, team_id): the league table. Computed
-- from finished fixtures only ('finished' is the actual fixture_status
-- enum value for a completed match — not 'completed'). Feeds league
-- position on fixture cards, the Match Centre drawer's table comparison,
-- and the fixture-difficulty heuristic (top 6 / bottom 6 by this same
-- ranking).
create or replace view public.league_team_standings as
with team_fixtures as (
  select
    gw.league_id,
    gw.season_id,
    f.home_team_id as team_id,
    f.home_goals as goals_for,
    f.away_goals as goals_against,
    case
      when f.home_goals > f.away_goals then 'win'
      when f.home_goals < f.away_goals then 'loss'
      else 'draw'
    end as outcome
  from public.fixtures f
  join public.gameweeks gw on gw.id = f.gameweek_id
  where f.status = 'finished'

  union all

  select
    gw.league_id,
    gw.season_id,
    f.away_team_id as team_id,
    f.away_goals as goals_for,
    f.home_goals as goals_against,
    case
      when f.away_goals > f.home_goals then 'win'
      when f.away_goals < f.home_goals then 'loss'
      else 'draw'
    end as outcome
  from public.fixtures f
  join public.gameweeks gw on gw.id = f.gameweek_id
  where f.status = 'finished'
),
aggregated as (
  select
    league_id,
    season_id,
    team_id,
    count(*) as played,
    count(*) filter (where outcome = 'win') as won,
    count(*) filter (where outcome = 'draw') as drawn,
    count(*) filter (where outcome = 'loss') as lost,
    sum(goals_for) as goals_for,
    sum(goals_against) as goals_against,
    sum(goals_for) - sum(goals_against) as goal_difference,
    count(*) filter (where outcome = 'win') * 3 + count(*) filter (where outcome = 'draw') as points
  from team_fixtures
  group by league_id, season_id, team_id
)
select
  league_id,
  season_id,
  team_id,
  played,
  won,
  drawn,
  lost,
  goals_for,
  goals_against,
  goal_difference,
  points,
  row_number() over (
    partition by league_id, season_id
    order by points desc, goal_difference desc, goals_for desc, team_id
  ) as position,
  count(*) over (partition by league_id, season_id) as teams_in_table
from aggregated;

-- One row per (player_id, season_id): goals/assists/cards derived
-- directly from fixture_events — the reliable source. Assists are
-- credited to a DIFFERENT player (fe.assist_player_id) than the one the
-- goal event row itself belongs to (fe.player_id, the scorer), so they're
-- aggregated separately and joined back in below. Deliberately does NOT
-- include minutes/starts/appearances (those depend on
-- fixture_player_status, a table with a known, pre-existing gap — see
-- docs/current-state.md ISSUE-2, not even present in the migration
-- history, and empty in this environment today); the frontend queries
-- that separately, best-effort, and hides it when unavailable rather than
-- baking an unreliable join into this view.
create or replace view public.player_season_stats as
with goal_stats as (
  select
    fe.player_id,
    gw.season_id,
    count(*) filter (where not fe.is_own_goal) as goals
  from public.fixture_events fe
  join public.fixtures f on f.id = fe.fixture_id
  join public.gameweeks gw on gw.id = f.gameweek_id
  where fe.event_type = 'goal' and fe.player_id is not null
  group by fe.player_id, gw.season_id
),
assist_stats as (
  select
    fe.assist_player_id as player_id,
    gw.season_id,
    count(*) as assists
  from public.fixture_events fe
  join public.fixtures f on f.id = fe.fixture_id
  join public.gameweeks gw on gw.id = f.gameweek_id
  where fe.event_type = 'goal' and fe.assist_player_id is not null
  group by fe.assist_player_id, gw.season_id
),
card_stats as (
  select
    fe.player_id,
    gw.season_id,
    count(*) filter (where fe.event_type = 'yellow_card') as yellow_cards,
    count(*) filter (where fe.event_type in ('red_card', 'second_yellow')) as red_cards
  from public.fixture_events fe
  join public.fixtures f on f.id = fe.fixture_id
  join public.gameweeks gw on gw.id = f.gameweek_id
  where fe.player_id is not null
    and fe.event_type in ('yellow_card', 'red_card', 'second_yellow')
  group by fe.player_id, gw.season_id
),
players_seasons as (
  select player_id, season_id from goal_stats
  union
  select player_id, season_id from assist_stats
  union
  select player_id, season_id from card_stats
)
select
  ps.player_id,
  ps.season_id,
  coalesce(g.goals, 0) as goals,
  coalesce(a.assists, 0) as assists,
  coalesce(c.yellow_cards, 0) as yellow_cards,
  coalesce(c.red_cards, 0) as red_cards
from players_seasons ps
left join goal_stats g on g.player_id = ps.player_id and g.season_id = ps.season_id
left join assist_stats a on a.player_id = ps.player_id and a.season_id = ps.season_id
left join card_stats c on c.player_id = ps.player_id and c.season_id = ps.season_id;
