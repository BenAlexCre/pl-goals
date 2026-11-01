-- Security remediation — views and the materialized view bypassed RLS for the
-- anon role.
--
-- Evidence (2026-10-09, hosted project, anon key only, no session):
--   underlying tables  fixtures / fixture_events / gameweeks / teams / players /
--                      player_team_history / fixture_player_match_stats → 0 rows
--   league_team_standings          → 20 rows
--   player_season_stats            → 5 rows
--   player_season_match_stats      → 40 rows
--   available_players_by_gameweek  → 24,548 rows
--   player_fixture_goals (matview) → 3 rows
-- Postgres views run with their OWNER's privileges unless security_invoker is
-- set, so RLS on the base tables (002_rls_policies.sql: "reference_data_read_*",
-- select to authenticated using (true)) was never evaluated for the caller.
--
-- Why this cannot break authenticated reads: every base table these views read
-- already has a `for select to authenticated using (true)` policy
-- (002 for seasons/leagues/teams/players/player_team_history/gameweeks/fixtures/
-- fixture_events; 036 for fixture_player_match_stats). With security_invoker the
-- caller's RLS applies, which for authenticated users is "all rows" — identical
-- result sets. Edge Functions use the service role (bypasses RLS) — unaffected.
--
-- Materialized views cannot carry RLS or security_invoker. player_fixture_goals
-- is read only by Edge Functions with the service role (pick5/predictor engines,
-- compute-scores) — grep confirms no frontend reader — so anon's SELECT grant is
-- simply revoked. authenticated keeps its grant (unchanged behaviour).
--
-- Requires Postgres 15+ (security_invoker); this project is on 17 (config.toml).
--
-- FUTURE REDEFINITIONS: any later `create or replace view` of these four views
-- must include `with (security_invoker = true)` to keep this protection.

alter view public.league_team_standings         set (security_invoker = true);
alter view public.player_season_stats           set (security_invoker = true);
alter view public.player_season_match_stats     set (security_invoker = true);
alter view public.available_players_by_gameweek set (security_invoker = true);

revoke select on public.player_fixture_goals from anon;
revoke select on public.player_fixture_goals from public;
