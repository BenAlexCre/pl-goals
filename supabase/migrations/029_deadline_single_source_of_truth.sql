-- Phase 19 — resolves ISSUE-24 properly (not just picking a number) and
-- implements the user's explicit new business rule: picks lock exactly
-- 15 minutes before the gameweek's earliest fixture kickoff.
--
-- Root cause of ISSUE-24, confirmed by reading every writer of this
-- column before touching anything (not assumed):
--   1. compute-deadlines/index.ts (Edge Function, cron + Manual Jobs)
--      computed `earliest - 30 minutes` and wrote it directly.
--   2. This trigger's own function, `refresh_gameweek_deadlines()` —
--      never tracked by any prior migration (out-of-band, the same class
--      of drift DEPLOYMENT.md already documents for other objects) —
--      fires AFTER every INSERT/UPDATE/DELETE on `fixtures` and computed
--      `earliest - 15 minutes`, with no exclusion for postponed/cancelled
--      fixtures (compute-deadlines already excluded those).
--   3. sync-fixtures/index.ts (Edge Function, api-football, never
--      successfully run in this environment) independently computed
--      `earliest - 30 minutes`.
--   4. frontend/scripts/fullSyncInsert.js (the actual script that
--      populated this project's real Premier League data, football-data.org)
--      computed `deadline_utc = kickoff` — a genuine, separate,
--      previously-undiscovered bug: zero offset at all. Documented as a
--      new issue (current-state.md) rather than folded silently into
--      ISSUE-24, since it's a distinct root cause.
-- Four independent implementations of one business rule, three different
-- wrong answers among them. Fixing the offset alone would not have
-- prevented this recurring — the actual fix is architectural: exactly
-- ONE authoritative writer.
--
-- This trigger/function pair becomes that one writer. It already fires on
-- every `fixtures` write regardless of which of the three ingestion paths
-- performed it (fullSyncInsert.js, sync-fixtures, or any future one),
-- and unlike a value written once at insert time, it re-derives the
-- correct answer from `fixtures` itself every time — so no ingestion
-- script's own (now also corrected, see the accompanying code changes)
-- arithmetic needs to be trusted as the last word. compute-deadlines'
-- own code no longer computes or writes deadline_utc at all (see that
-- function's own updated comment) — it now only reads the value this
-- trigger already maintains, to decide when to call each mode's
-- lockEntries(). sync-fixtures/index.ts and fullSyncInsert.js were also
-- corrected to write the right value on their own initial insert (defense
-- in depth — this trigger is the enforced last word either way, but a
-- momentarily-wrong value is worth avoiding, not just tolerating).
--
-- Guarded `create or replace`/`drop trigger if exists` + recreate, not a
-- bare `create`, so this replays safely both on a fresh project (nothing
-- exists yet) and on this project's own database (both objects already
-- exist, out-of-band, and must end up with this corrected definition).

create or replace function public.refresh_gameweek_deadlines()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.gameweeks gw
  set
    earliest_kickoff_utc = src.earliest_kickoff_utc,
    deadline_utc = src.earliest_kickoff_utc - interval '15 minutes'
  from (
    select
      f.gameweek_id,
      min(f.kickoff_utc) as earliest_kickoff_utc
    from public.fixtures f
    where f.gameweek_id is not null
      and f.kickoff_utc is not null
      and f.status not in ('postponed', 'cancelled')
    group by f.gameweek_id
  ) src
  where src.gameweek_id = gw.id;

  update public.gameweeks
  set
    earliest_kickoff_utc = null,
    deadline_utc = null
  where id not in (
    select distinct f.gameweek_id
    from public.fixtures f
    where f.gameweek_id is not null
      and f.kickoff_utc is not null
      and f.status not in ('postponed', 'cancelled')
  );
end;
$$;

create or replace function public.trigger_refresh_gameweek_deadlines()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.refresh_gameweek_deadlines();
  return null;
end;
$$;

drop trigger if exists trg_refresh_gameweek_deadlines_on_fixtures on public.fixtures;

create trigger trg_refresh_gameweek_deadlines_on_fixtures
after insert or update or delete on public.fixtures
for each statement
execute function public.trigger_refresh_gameweek_deadlines();

-- Recompute every existing gameweek's deadline right now, using this same
-- corrected, authoritative function — not a manually fabricated
-- timestamp. Real, legitimate recalculation of real fixture data already
-- in the table.
select public.refresh_gameweek_deadlines();
