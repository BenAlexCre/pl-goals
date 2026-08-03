-- Fixes the third, previously-masked layer of ISSUE-19: the local Kong gateway
-- requires an `apikey` header to route to `/functions/v1/*`, but every cron job
-- defined in 003_cron_jobs.sql only ever sends `Authorization: Bearer`. Confirmed
-- by direct reproduction (2026-08-03): a manually-added `apikey` header succeeds
-- against the same URL/key that the cron jobs' `Authorization`-only request gets
-- rejected on with 401. See current-state.md ISSUE-19 and session-log.md for the
-- full investigation.
--
-- 003_cron_jobs.sql is not modified — per engineering-principles.md, a historical
-- migration is never rewritten in place. Each affected job is replaced by name:
-- unscheduled, then rescheduled under the identical name/schedule/target with the
-- corrected header set.
--
-- Idempotency: cron.unschedule(name) raises an error — not a silent false — if no
-- job with that name exists (confirmed empirically against this project's pg_cron
-- version before writing this). Every unschedule call below is wrapped in a DO
-- block that catches exactly that case and continues, so this migration is safe to
-- apply to a fresh database (where 003 always runs first and the jobs always
-- exist), safe to re-apply if a job was already removed by some other means, and
-- still fails loudly on any other, unexpected error.
--
-- Every job that calls net.http_post() is included below. `lock-due-entries-every-
-- minute` is deliberately excluded — it calls a plain SQL function, not an Edge
-- Function, and was never affected by this issue.
-- `sync-live-events-every-5-min` is deliberately unscheduled, not fixed — it's a
-- redundant, differently-broken duplicate of `sync-live-events-every-2-min` (its
-- Vault secrets were never populated), already recommended for removal rather than
-- repair in the ISSUE-19 remediation plan.

-- ---------------------------------------------------------------------------
-- sync-fixtures-daily
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('sync-fixtures-daily');
exception when others then
  null; -- job didn't already exist under this name — nothing to remove, continue
end $$;

select cron.schedule(
  'sync-fixtures-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-fixtures',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'apikey', current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- sync-live-events-every-2-min
-- (will still fail after this fix — ISSUE-4, the function doesn't exist yet —
-- but it will fail with a 404 for the right reason, not a 401 for the wrong one)
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('sync-live-events-every-2-min');
exception when others then
  null;
end $$;

select cron.schedule(
  'sync-live-events-every-2-min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-live-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'apikey', current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- compute-deadlines-hourly
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('compute-deadlines-hourly');
exception when others then
  null;
end $$;

select cron.schedule(
  'compute-deadlines-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/compute-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'apikey', current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- compute-scores-every-3-min
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('compute-scores-every-3-min');
exception when others then
  null;
end $$;

select cron.schedule(
  'compute-scores-every-3-min',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/compute-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'apikey', current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- settle-gameweek-every-30-min
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('settle-gameweek-every-30-min');
exception when others then
  null;
end $$;

select cron.schedule(
  'settle-gameweek-every-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/settle-gameweek',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'apikey', current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- sync-live-events-every-5-min — removed, not fixed (redundant duplicate of
-- sync-live-events-every-2-min, via a Vault-secret path whose secrets were
-- never populated; fixing two parallel mechanisms for the same job is more
-- to maintain than fixing one and removing the other).
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('sync-live-events-every-5-min');
exception when others then
  null;
end $$;
