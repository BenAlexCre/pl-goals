-- Phase 22 (Production Live-Match Event Pipeline) — schedules the new
-- `sync-live-scores` Edge Function, which closes the gap documented in
-- its own source: nothing previously updated `fixtures.status`/
-- `home_goals`/`away_goals`/`minute` during a live match (`sync-fixtures`
-- runs once daily; the WhoScored worker only ever wrote `fixture_events`).
--
-- Every minute, continuously — not just during "expected" matchday
-- windows — because the function itself does a free, local-only DB
-- check first and returns immediately without calling football-data.org
-- at all unless a fixture is actually within its live-relevant window
-- (same -10min/+130min logic `ws-live-events.js` already uses). This
-- keeps the schedule simple (no day-of-week/hour-range cron expression
-- to get wrong for cup replays or rearranged midweek fixtures) while
-- costing zero external API calls the vast majority of the time.
select cron.schedule(
  'sync-live-scores-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-live-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);
