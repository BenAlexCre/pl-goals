-- Phase 22 (Production Live-Match Event Pipeline) — real out-of-band drift
-- found while auditing the WhoScored live-event worker's idempotency
-- guarantee: `frontend/scripts/ws-live-events.js` has upserted against
-- `onConflict: 'fixture_id,event_type,minute,team_id,player_id'` since it
-- was written (see its own inline comment naming the exact constraint it
-- expects: `fixtureevents_uniq`), and this project's own live local
-- database does in fact have exactly that constraint —
-- `fixtureevents_uniq UNIQUE (fixture_id, event_type, minute, team_id,
-- player_id)`, confirmed via `pg_constraint` — but no migration anywhere
-- created it. `001_initial_schema.sql` as currently written instead
-- declares `unique (fixture_id, provider_id)`, which is NOT present on
-- the live database at all. Same class of gap as `ISSUE-21`/`ISSUE-24`/
-- migration 028's own realtime-publication drift: an object that exists
-- out-of-band locally, that a fresh hosted project built purely from the
-- tracked migrations would NOT have — meaning a fresh deployment's
-- `ws-live-events.js` would get a real Postgres error on every single
-- upsert call (no matching unique/exclusion constraint for the given
-- onConflict target), silently writing zero event rows while appearing
-- to run normally (the error is caught and logged, not thrown).
--
-- This migration formalizes the constraint the application code has
-- always actually relied on, rather than changing the application code
-- to match a schema declaration nothing enforces live. `event_type +
-- minute + team_id + player_id` per fixture is a reasonable natural key
-- for a match incident — WhoScored's own feed has no independent stable
-- per-event ID to key against instead (confirmed by reading
-- `ws-live-events.js`'s own event-parsing code), so this composite key
-- is the correct, minimal choice, not a workaround.
--
-- Guarded to replay safely on both a fresh project (gets the stale
-- `provider_id`-based constraint from 001, needs it swapped) and this
-- project's own database (already has `fixtureevents_uniq`, correctly
-- named — no-ops).

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.fixture_events'::regclass
      and conname = 'fixture_events_fixture_id_provider_id_key'
  ) then
    alter table public.fixture_events
      drop constraint fixture_events_fixture_id_provider_id_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fixture_events'::regclass
      and conname = 'fixtureevents_uniq'
  ) then
    alter table public.fixture_events
      add constraint fixtureevents_uniq
      unique (fixture_id, event_type, minute, team_id, player_id);
  end if;
end
$$;
