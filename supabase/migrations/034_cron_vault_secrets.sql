-- Production architecture correction, not a bug fix for application logic.
--
-- The hosted production project (rgohuoooujqclcfkoaht) proved that
-- `alter database postgres set app.settings.supabase_url = ...` and the
-- equivalent for `app.settings.service_role_key` both fail with
-- `42501: permission denied to set parameter` — even connecting as the
-- `postgres` role. Every cron job created by `003_cron_jobs.sql` and
-- `006_fix_cron_job_headers.sql` (and `033_sync_live_scores_cron.sql`)
-- reads these two GUCs via `current_setting(...)`, so on this hosted
-- project none of them could ever have worked, independent of pg_net.
--
-- This migration removes all dependence on both GUCs and switches to
-- Supabase Vault (`supabase_vault`, already installed on this project —
-- confirmed live via `select extname from pg_extension` — defensively
-- declared below anyway so a fresh project gets it too) for the one
-- genuine secret involved, the service-role key. `vault.decrypted_secrets`
-- is confirmed grantable to `postgres` (the role every cron job in
-- `cron.job` already runs as — confirmed live via `select username from
-- cron.job`), so no new grants are needed for cron itself to read it.
--
-- The project URL is not a secret — it's used directly, per this
-- project's own explicit instruction, rather than routed through Vault
-- or a GUC. This does mean this migration's cron commands are baked to
-- this specific hosted project; that's an accepted, explicit trade-off,
-- not an oversight — this project's own established local-testing
-- methodology has never relied on local `cron.job` rows actually firing
-- successfully end-to-end (every phase so far has tested Edge Functions
-- locally via `supabase functions serve` + a direct HTTP call instead),
-- so this doesn't regress anything actually exercised locally.
--
-- Same idempotent-replace idiom `006_fix_cron_job_headers.sql` already
-- established: unschedule (catching the "doesn't exist" exception so
-- this replays safely on a fresh project too, where these jobs would
-- already exist correctly from 003/006/033 and this migration simply
-- re-defines them in place), then reschedule under the identical
-- name/schedule/target. `sync-live-scores-every-minute` additionally
-- gains the `apikey` header the other five jobs already have (missing
-- from `033_sync_live_scores_cron.sql` — the same Kong-routing
-- requirement `006` documents; not fixed until now since this is the
-- first time that job's command is being touched again).
--
-- The Vault secret itself (`service_role_key`) is NOT created here —
-- doing so would mean embedding the real service-role key value in a
-- migration file, which must never happen. It's created out-of-band,
-- once, via the Supabase Dashboard SQL Editor or `vault.create_secret()`
-- run directly against the project — see DEPLOYMENT.md for the exact
-- non-committed procedure. Until that secret exists, `(select
-- decrypted_secret from vault.decrypted_secrets where name =
-- 'service_role_key')` simply returns null and the `Authorization`
-- header is null — the cron job stays registered and this migration
-- still applies cleanly, it just doesn't succeed until the secret is
-- populated, identical in spirit to how the GUCs being unset never
-- blocked 003/006/033 from applying either.

create extension if not exists "supabase_vault";

-- ---------------------------------------------------------------------------
-- sync-fixtures-daily
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('sync-fixtures-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'sync-fixtures-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://rgohuoooujqclcfkoaht.supabase.co/functions/v1/sync-fixtures',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- sync-live-events-every-2-min
-- (still expected to 404 — ISSUE-4, the function doesn't exist — but now
-- for the right reason, not a permission/auth failure)
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
    url := 'https://rgohuoooujqclcfkoaht.supabase.co/functions/v1/sync-live-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
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
    url := 'https://rgohuoooujqclcfkoaht.supabase.co/functions/v1/compute-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
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
    url := 'https://rgohuoooujqclcfkoaht.supabase.co/functions/v1/compute-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
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
    url := 'https://rgohuoooujqclcfkoaht.supabase.co/functions/v1/settle-gameweek',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- sync-live-scores-every-minute
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('sync-live-scores-every-minute');
exception when others then
  null;
end $$;

select cron.schedule(
  'sync-live-scores-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rgohuoooujqclcfkoaht.supabase.co/functions/v1/sync-live-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);
