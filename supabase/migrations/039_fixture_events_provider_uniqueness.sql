-- Remediation (C3, red-team audit) — CRITICAL: fixture_events' only
-- uniqueness/idempotency key was (fixture_id, event_type, minute, team_id,
-- player_id). WhoScored buckets stoppage-time events into their base
-- minute (45+2' -> minute=45, confirmed live against real matchCentreData
-- this session — extra_minute is deliberately always null, a prior,
-- separate, correct fix for a different fabrication concern). Two
-- genuine, distinct goals by the same player in the same base minute
-- (e.g. 45' and 45+2') therefore share an identical conflict key — the
-- second upsert silently overwrites the first as if it were a re-poll of
-- the same event, permanently losing one goal with no error anywhere.
-- Pick 5 scoring and player_season_stats both read directly from this
-- table, so this is a real, silent scoring-accuracy bug, not theoretical.
--
-- Fix: `provider_id` already exists on this table but was being written
-- as the literal string 'whoscored' (the PROVIDER's name, not an event
-- identity) — ws-live-events.js is updated in this same change to write
-- the real WhoScored event id (`ev.id`, confirmed present and genuinely
-- unique per kick/event on every real event object inspected this
-- session) instead. `(fixture_id, provider_id)` becomes the new natural
-- key: two distinct WhoScored events can never collide regardless of
-- which minute they're bucketed into, and the SAME event re-ingested on
-- a later poll cycle correctly upserts onto its own existing row.
--
-- Existing rows (all currently 'whoscored' placeholder, from this
-- session's own manual Arsenal-Coventry ingestion, which stored a
-- simplified object rather than the full raw WhoScored event and so has
-- no real event id to recover) are backfilled with their own surrogate
-- PK cast to text — this is NOT presented as a real provider identity,
-- just a guaranteed-unique placeholder so the new constraint can apply
-- without fabricating a fake WhoScored id that could later collide with
-- an actually-real one on re-ingestion. Any future real re-ingestion for
-- this fixture will naturally replace these placeholder rows' data via
-- the OLD (fixture_id, event_type, minute, team_id, player_id) shape no
-- longer applying — they will simply coexist as extra rows until a
-- human/ops decision to clean them up, which is safer than silently
-- deleting or renumbering historical data in a migration.

update public.fixture_events
set provider_id = id::text
where provider_id = 'whoscored' or provider_id is null;

alter table public.fixture_events
  drop constraint if exists fixtureevents_uniq;

alter table public.fixture_events
  add constraint fixture_events_provider_uniq unique (fixture_id, provider_id);

comment on constraint fixture_events_provider_uniq on public.fixture_events is
  'Remediation (C3) — replaces fixtureevents_uniq (fixture_id, event_type, minute, team_id, player_id), which could not distinguish two genuine events sharing a bucketed minute (e.g. 45'' and 45+2''). provider_id must hold the real per-provider event identity (WhoScored''s own event id) for this constraint to mean anything — enforced by convention in ws-live-events.js, not by the database (provider_id has no format check, since a future second ingestion source would need its own identity shape).';

comment on column public.fixture_events.provider_id is
  'Remediation (C3) — the source provider''s own identity for this exact event record (e.g. WhoScored''s event id), NOT the provider''s name. Forms the real natural key with fixture_id (see fixture_events_provider_uniq) — (event_type, minute, team_id, player_id) alone cannot distinguish two genuine events sharing a stoppage-time-bucketed minute.';
