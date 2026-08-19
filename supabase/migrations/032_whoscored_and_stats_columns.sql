-- Phase 22 (Production Live-Match Event Pipeline) — a second, larger
-- piece of out-of-band schema drift found alongside 031's constraint
-- gap: the entire WhoScored pipeline depends on columns that exist on
-- this project's own live local database but were never captured by
-- any migration. `001_initial_schema.sql`'s `fixtures`/`teams`/`players`
-- tables have no `whoscored_fixture_id`/`whoscoredteamid`/
-- `whoscoredplayerid` at all — meaning a fresh hosted project built
-- purely from migrations 001-031 would be missing the very columns
-- `frontend/scripts/sync-whoscored-fixture-map.js`,
-- `sync-whoscored-teamids.js`, `sync-whoscored-player-map.js`, and
-- `ws-live-events.js` all read and write, and every one of those
-- scripts would fail outright with "column does not exist" on first
-- use. Also missing: `fixtures.stats_status`/`stats_last_synced_at`/
-- `stats_next_sync_at`/`stats_finalized_at`/`finished_at` — columns
-- that already exist live, are indexed live (`idx_fixtures_stats_status`,
-- `idx_fixtures_stats_next_sync`), but are not read or written by any
-- current application code (confirmed by grep across `frontend/src`,
-- `frontend/scripts`, `supabase/functions` — zero references). These
-- read as scaffolding for a stats-sync lifecycle that was never
-- finished, not something safe to drop (no evidence of what depended
-- on it, and dropping a column is destructive) — captured here as-is
-- so a fresh deployment's schema actually matches this project's own
-- live schema, without inventing new behavior around them.
--
-- All additive/nullable, safe to run against an already-drifted
-- database (this project's own) via `IF NOT EXISTS` — no-ops here,
-- real column adds on a genuinely fresh project.

alter table public.fixtures add column if not exists whoscored_fixture_id text;
alter table public.fixtures add column if not exists stats_status text not null default 'pending';
alter table public.fixtures add column if not exists stats_last_synced_at timestamptz;
alter table public.fixtures add column if not exists stats_next_sync_at timestamptz;
alter table public.fixtures add column if not exists stats_finalized_at timestamptz;
alter table public.fixtures add column if not exists finished_at timestamptz;

create unique index if not exists fixtures_whoscored_fixture_id_key
  on public.fixtures (whoscored_fixture_id)
  where whoscored_fixture_id is not null;

create index if not exists idx_fixtures_stats_status on public.fixtures(stats_status);
create index if not exists idx_fixtures_stats_next_sync on public.fixtures(stats_next_sync_at);

alter table public.teams add column if not exists whoscoredteamid text;
create index if not exists idx_teams_whoscored on public.teams(whoscoredteamid);

alter table public.players add column if not exists whoscoredplayerid text;
create index if not exists idx_players_whoscored on public.players(whoscoredplayerid);
