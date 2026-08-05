-- Production readiness audit (2026-08-05): the supabase_realtime publication
-- exists but has zero tables registered (confirmed live via
-- pg_publication_tables — 0 rows, puballtables = false). Every
-- postgres_changes subscription in the app (frontend/src/hooks/useLiveScores.js
-- — fixtures, fixture_events, fixture_player_status, pick5_picks) has
-- therefore been silently non-functional: no error is raised anywhere, the
-- subscription callback simply never fires, so "live pick outcomes"
-- (architecture.md § Request flow, GameweekPage.jsx's own header text)
-- has never actually updated in real time, only via each hook's own
-- polling (refetchInterval/staleTime).
--
-- Adds the three tables that ARE captured in versioned migrations.
-- fixture_player_status is deliberately excluded here — it is not itself
-- defined in any migration (current-state.md ISSUE-2), so
-- `alter publication ... add table public.fixture_player_status` would fail
-- to replay on a fresh database. Add it once ISSUE-2 gives that table a
-- proper migration of its own; not attempted here.
--
-- Realtime respects each subscriber's own RLS policies for postgres_changes
-- (confirmed: this is Supabase's documented default behavior, not a
-- configuration this migration changes) — adding a table to this
-- publication does not bypass RLS, it only enables the change-data-capture
-- stream those policies already gate per-subscriber.

alter publication supabase_realtime add table public.fixtures;
alter publication supabase_realtime add table public.fixture_events;
alter publication supabase_realtime add table public.pick5_picks;
