-- Phase 24 — deactivates (never deletes) the obsolete `sync-live-events-
-- every-2-min` cron job. Approved by the project owner: the persistent
-- Railway WhoScored worker (frontend/scripts/ws-live-events.js) now
-- replaces this cron-triggered-Edge-Function architecture entirely —
-- `sync-live-events` has never existed as an Edge Function (`ISSUE-4`)
-- and never should, since live-event scraping needs a real Chromium
-- browser, which cannot run in Supabase's Edge Runtime and cannot be
-- invoked by pg_cron (not an HTTP API) — see decisions.md § Phase 22/23.
-- Leaving this job active meant a permanent, unfixable 404 on every
-- tick, polluting `cron.job_run_details`/`net._http_response` and
-- risking a future reader mistaking it for a real, fixable failure.
--
-- `cron.unschedule()` is deliberately NOT used here — the job is
-- deactivated (`active = false`) via `cron.alter_job()`, not removed.
-- pg_cron simply skips a job with `active = false` on every tick (no
-- run, no `job_run_details` row, no error) — this is fully reversible
-- with a single `cron.alter_job(job_id, active := true)` if ever
-- needed, and preserves the job's own history/definition for reference.
--
-- Guarded exactly like this project's other cron-correcting migrations
-- (006, 033, 034): only acts if a job with this exact name still exists
-- and is currently active, so this replays safely on a fresh project
-- (where 003/006 already created it) and no-ops harmlessly if it was
-- ever already deactivated or removed by some other means. No other
-- job's schedule, command, or active state is touched.

do $$
declare
  target_job_id bigint;
begin
  select jobid into target_job_id
  from cron.job
  where jobname = 'sync-live-events-every-2-min';

  if target_job_id is not null then
    perform cron.alter_job(target_job_id, active := false);
  end if;
end
$$;
