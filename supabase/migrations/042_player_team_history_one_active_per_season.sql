-- Remediation (F5, red-team audit) — 16 real players were found with TWO
-- simultaneously is_active=true rows in player_team_history for the same
-- season (e.g. Alejandro Garnacho active at both Aston Villa FC and
-- Chelsea FC at once), corrupting Score Predictor's and Pick 5's
-- goalscorer-eligibility pickers. Root cause: frontend/scripts/
-- fullSyncPlayers.js's markExistingTeamHistoryInactive() only ever
-- deactivated a player's OLD team row when that OLD team's own sync
-- happened to run again in the same pass (scoped by team+season, not by
-- player) — a transfer away from a team that wasn't re-synced (TEAM_FILTER
-- is an explicitly supported partial-sync mode) left a stale active row
-- behind forever. Fixed in that same commit (deactivateOtherActiveTeams).
--
-- This migration is deliberately applied AFTER the 16 existing corrupt
-- rows are individually corrected (see the same remediation's cleanup
-- step, using football-data.org — the authoritative source this app
-- already syncs from — to determine each player's true current club) —
-- adding it beforehand would fail immediately against the still-corrupt
-- data.
--
-- Existing unique constraint player_team_history_player_id_team_id_
-- season_id_key (player_id, team_id, season_id) already prevents a
-- duplicate row for the SAME team, and is left untouched — this adds the
-- separate, previously-missing invariant: at most one row PER PLAYER PER
-- SEASON may be is_active=true, regardless of which team. A loan/dual
-- registration is not a case this app's data model represents (football-
-- data.org's own squad listing reflects exactly one current club per
-- player), so this constraint is compatible with every legitimate
-- workflow the sync script exercises.

create unique index player_team_history_one_active_per_season
  on public.player_team_history (player_id, season_id)
  where is_active = true;

comment on index player_team_history_one_active_per_season is
  'Remediation (F5) — enforces at most one active team per player per season at the DB level, independent of application-code correctness. Catches any future sync-logic regression as a hard constraint violation instead of silent data corruption.';
