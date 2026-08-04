-- Discovered while building Pick5Engine.validateEntry() (Milestone 4, Slice 2,
-- docs/game-engine.md § GE-6): public.players.position has a live 'Coach'
-- value (non-playing staff stored in the same table/player_team_history shape
-- as players — confirmed live, 2026-08-04), and
-- available_players_by_gameweek (001_initial_schema.sql) never filtered it
-- out. A coach cannot score a goal, so including one in this view is a
-- functional bug for any mode that reads it, not a rule anyone chose (see
-- current-state.md ISSUE-23).
--
-- Deliberately fixed at the shared view level (GE-3: this view is shared
-- platform infrastructure, not Pick 5-specific), unlike goalkeeper exclusion,
-- which stays inside Pick5Engine.validateEntry() because it's a genuine,
-- mode-specific product decision (ISSUE-7) — Score Predictor's goalscorer
-- prediction (GE-5.3, Milestone 6) may legitimately want goalkeepers in its
-- own candidate pool even though Pick 5 excludes them, but no mode should
-- ever offer a coach.
--
-- "position is null or position <> 'Coach'" rather than a bare "<> 'Coach'":
-- a bare inequality evaluates to NULL (excluding the row) for any player with
-- an unset position, silently narrowing the picker for an unrelated reason.
-- No live row currently has a null position (confirmed 2026-08-04), but nulls
-- passing through is the correct semantics regardless of today's data.

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
where f.status not in ('postponed', 'cancelled')
  and (p.position is null or p.position <> 'Coach');
