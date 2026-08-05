-- Milestone 4, Slice 3 (lockEntries) — docs/game-engine.md § GE-6.
--
-- Adds the index docs/schema-review.md #8 already recommended
-- ("Add idx_game_entries_gameweek_status and idx_notifications_unread") but
-- deliberately left unapplied at Milestone 2 time, since nothing yet
-- exercised the query shape it exists for. Pick5Engine.lockEntries()
-- (supabase/functions/_shared/game-engine/pick5/engine.ts), wired into
-- compute-deadlines this slice and run every hour by cron, is exactly that
-- query: `where gameweek_id = $1 and status = 'pending'`, scanned once per
-- upcoming/live gameweek per tick. idx_notifications_unread is not added
-- here — nothing yet reads notifications by read status, so there's still no
-- query to justify it; add it if/when Milestone 7 (notification delivery)
-- actually needs it.

create index idx_game_entries_gameweek_status
  on public.game_entries (gameweek_id, status)
  where gameweek_id is not null;
