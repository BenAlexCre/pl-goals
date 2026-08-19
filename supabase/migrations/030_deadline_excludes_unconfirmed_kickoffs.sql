-- Phase 19 (mid-session addition) — real gap found while investigating a
-- reported "00:00 shown as a real kickoff" bug: `refresh_gameweek_deadlines()`
-- (029_deadline_single_source_of_truth.sql) already excluded
-- postponed/cancelled fixtures from the earliest-kickoff calculation, but
-- not `'tbd'` fixtures (status now correctly populated by the ingestion
-- fix in this same phase — see fullSyncInsert.js/sync-fixtures's own
-- updated comments). A `'tbd'` fixture's `kickoff_utc` is a literal
-- `00:00:00Z` placeholder, not a real time — including it in `min()`
-- could make a gameweek's "earliest kickoff" (and therefore its
-- `deadline_utc`, "picks lock 15 minutes before gameweek start") derive
-- from a placeholder instead of a real fixture, or from a real fixture
-- when the true earliest confirmed one is later than an unconfirmed one
-- that happens to sort first.
--
-- A gameweek where every fixture is still unconfirmed now correctly gets
-- `earliest_kickoff_utc = deadline_utc = null` (same null-handling branch
-- this function already had for "no fixtures at all") — the frontend
-- already renders "Time TBC" and skips the countdown whenever this field
-- is null (formatFixtureKickoff()/resolveGameweekState(), Dashboard.jsx),
-- so no additional frontend branching was needed for this case once the
-- underlying value is correctly null instead of a fabricated timestamp.

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
      and f.status not in ('postponed', 'cancelled', 'tbd')
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
      and f.status not in ('postponed', 'cancelled', 'tbd')
  );
end;
$$;

-- Recompute every existing gameweek with this corrected function — real
-- recalculation from real fixture data, not a fabricated timestamp.
select public.refresh_gameweek_deadlines();
