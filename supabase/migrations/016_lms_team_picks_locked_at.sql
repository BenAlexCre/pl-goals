-- Milestone 5, Slice 3 (locking) — docs/game-engine.md § GE-5.2 / GE-6.
--
-- lms_team_picks.locked_at: set by LmsEngine.lockEntries() once a
-- gameweek's deadline passes, on every not-yet-locked pick for that
-- gameweek. Nullable — null means "still editable."
--
-- Deliberately NOT a game_entries.status transition, unlike Pick 5's own
-- lockEntries() (which flips game_entries.status 'pending' -> 'locked').
-- game_entries is season-scoped for LMS (GE-4.5) — one row for the whole
-- competition, not one per gameweek — so locking the parent entry at a
-- single gameweek's deadline would make it impossible to ever submit a
-- pick for the *next* gameweek. The thing that actually needs to become
-- immutable at a deadline is this specific gameweek's pick, not the
-- season-long entry itself. See docs/decisions.md § LMS locking for the
-- full reasoning.

alter table public.lms_team_picks
  add column locked_at timestamptz;

comment on column public.lms_team_picks.locked_at is
  'GE-5.2/GE-6: set by LmsEngine.lockEntries() when this pick''s gameweek deadline passes. Null = still editable. Unlike Pick 5, the parent game_entries row is never locked for LMS — only the individual gameweek pick is, since the entry itself spans the whole competition.';
