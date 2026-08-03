select cron.schedule(
  'sync-fixtures-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-fixtures',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

select cron.schedule(
  'sync-live-events-every-2-min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-live-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

select cron.schedule(
  'compute-deadlines-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/compute-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

select cron.schedule(
  'compute-scores-every-3-min',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/compute-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);

select cron.schedule(
  'settle-gameweek-every-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/settle-gameweek',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);