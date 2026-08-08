-- Milestone 6, Slice 3 (locking) — docs/game-engine.md § GE-5.3 / GE-6.
--
-- predictor_fixture_picks.locked_at: set by PredictorEngine.lockEntries()
-- once a gameweek's deadline passes, on every not-yet-locked pick for that
-- gameweek. Nullable — null means "still editable."
--
-- Deliberately NOT a game_entries.status transition, same reasoning as
-- LmsEngine.lockEntries() (016_lms_team_picks_locked_at.sql): game_entries
-- is season-scoped for Score Predictor (GE-4.5, same shape as LMS) — one
-- row for the whole competition, not one per gameweek — so locking the
-- parent entry at a single gameweek's deadline would make it impossible to
-- ever submit a prediction for the *next* gameweek. The thing that
-- actually needs to become immutable at a deadline is this specific
-- gameweek's prediction, not the season-long entry itself. Not copied from
-- LMS blindly — the same structural fact (a season-scoped game_entries
-- row) drives the same conclusion independently; see docs/decisions.md §
-- Score Predictor locking for the full reasoning, including why "lock the
-- entry" and "lock both" were considered and rejected.

alter table public.predictor_fixture_picks
  add column locked_at timestamptz;

comment on column public.predictor_fixture_picks.locked_at is
  'GE-5.3/GE-6: set by PredictorEngine.lockEntries() when this prediction''s gameweek deadline passes. Null = still editable. Like LMS, the parent game_entries row is never locked — only the individual gameweek''s prediction is, since the entry itself spans the whole competition. Not read by PredictorEngine.validateEntry() itself, which gates submission via a live deadline comparison instead (same reasoning as LmsEngine.validateEntry()) — this column is an explicit, queryable "is this final" signal for future slices (calculateScore()/settle()), not the enforcement mechanism.';
