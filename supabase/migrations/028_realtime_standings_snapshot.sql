-- Phase 16 (Hosted Beta Deployment) — real gap found during the realtime
-- audit: `frontend/src/hooks/useLiveScores.js` subscribes to
-- `postgres_changes` on `public.pot_standings_snapshots` (Phase 8C, live
-- LMS/leaderboard updates), but this table was never added to the
-- `supabase_realtime` publication by any migration — 011_realtime_publication.sql
-- added `fixtures`/`fixture_events`/`pick5_picks` only. It IS present in
-- this project's own local publication today, confirmed via
-- `pg_publication_tables`, but that's out-of-band drift (added manually at
-- some point, the same class of gap 011's own comment already documents
-- for the publication as a whole) — not something a fresh hosted project
-- built purely from migrations 001-027 would have. Without this, live
-- standings updates would silently never fire on a fresh production
-- database: no error anywhere, exactly like the original bug 011 fixed for
-- the other three tables.
--
-- Guarded with a duplicate-membership check (unlike 011's plain
-- unconditional ALTER PUBLICATION) so this migration replays safely both
-- on a fresh project (table not yet a member — adds it) and on this
-- project's own existing local database (table already a member from the
-- earlier manual/out-of-band add — no-ops instead of erroring
-- "relation is already member of publication").

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pot_standings_snapshots'
  ) then
    alter publication supabase_realtime add table public.pot_standings_snapshots;
  end if;
end
$$;
