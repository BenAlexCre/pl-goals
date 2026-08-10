# API

Last reviewed: 2026-08-10. There is no custom REST/GraphQL backend — the "API" here is
(1) Supabase's auto-generated PostgREST API used directly by the frontend, and (2) five
Deno edge functions for operations that need to bypass RLS or call external services.

This document describes **contracts**: what each endpoint accepts, does, and returns.
It changes only when an endpoint's behavior changes. For whether an endpoint is
actually wired up to any UI, or whether it's currently producing correct results, see
[current-state.md](./current-state.md), linked by `ISSUE-N` below wherever relevant.

See also: [database.md](./database.md) (the schema these endpoints read/write),
[architecture.md](./architecture.md) (how these fit into the overall request flow).

## 1. Data API (PostgREST via supabase-js)

The frontend never calls PostgREST via raw HTTP; it always goes through
`@supabase/supabase-js` (`frontend/src/lib/supabase.js`), which handles auth headers,
JSON encoding, and query building. Every table/view listed in
[database.md](./database.md) is reachable this way, gated by RLS. There's no separate
"API layer" to document beyond the schema itself and the query shapes each hook uses
— see `frontend/src/hooks/*.js` for the exact `select()`/`insert()`/`update()`/`rpc()`
calls in use.

Two RPCs are referenced but not defined in any migration — `get_or_create_entry` and
`save_entry_picks`, called only from the dead `frontend/src/lib/gameAPI.js` — see
[database.md § Schema drift](./database.md#schema-drift).

## 2. Edge Functions

Base URL: `${VITE_SUPABASE_URL}/functions/v1/<name>`. All functions handle `OPTIONS`
for CORS (`supabase/functions/_shared/cors.ts` — permissive: `Access-Control-Allow-
Origin: *`) and return JSON with `Content-Type: application/json`.

### `POST /functions/v1/admin-actions`
**Auth:** required. Reads the caller's identity from the forwarded `Authorization`
header via a user-scoped Supabase client, then checks — using a service-role client —
whether the caller is an admin of the target pot (`pot_members.role = 'admin'`) or an
app admin (`app_metadata.role = 'app_admin'`). Returns `401` if unauthenticated, `403`
if neither check passes.

Request body: `{ action, pot_id, ...action-specific fields }`

| action | extra fields | effect |
|---|---|---|
| `mark_paid` | `user_id`, `gameweek_id` | upserts `entry_payments.is_paid = true`, records `marked_by`/`marked_at` |
| `mark_unpaid` | `user_id`, `gameweek_id` | upserts `entry_payments.is_paid = false`; also sets the matching `user_entries` row to `is_void = true, status = 'void'` |
| `add_member` | `invite_user_id` | upserts a `pot_members` row with `role = 'member'` |
| `remove_member` | `remove_user_id` | deletes the matching `pot_members` row |

Unknown `action` → `400`. Any thrown error inside the switch → `500` with
`{ error: message }`.

Frontend caller: `hooks/useAdmin.js:useAdminAction`. Whether anything currently
invokes that hook, and why not: [current-state.md ISSUE-6](./current-state.md#issue-6--payment-verification-has-no-ui-or-bulk-import-compute-scoressettle-will-void-every-entry).

### `POST /functions/v1/sync-fixtures`
**Auth:** requires either the service-role key (the real cron caller) or a
signed-in `app_admin` session (`_shared/adminOrCronAuth.ts`, added Launch
Readiness Sprint 1A, resolves
[current-state.md ISSUE-26](./current-state.md#issue-26--compute-deadlinescompute-scoressettle-gameweeksync-fixtures-accepted-unauthenticated-requests) —
previously enforced nothing). Pulls from **api-football**
(`v3.football.api-sports.io`), using the `VITE_FOOTBALL_DATA_KEY` env var as the
api-football key (the name is misleading — this key is api-football's, not
football-data.org's, despite `VITE_FOOTBALL_DATA_KEY` suggesting the latter).

Request body (all optional): `{ competitionId, triggeredBy }`. `competitionId`
defaults to the `COMPETITION_ID` env var, then to the literal string `'WC'` coerced
with `Number(...)` — which produces `NaN`. In practice this function requires
`competitionId` in the request body or a numeric `COMPETITION_ID` env var to do
anything useful; the string fallback is not actually usable as written.

Flow: creates a `sync_runs` row → looks up the current season (`seasons.is_current`)
→ fetches league info, teams, squads, and fixtures from api-football → upserts
`leagues`, `teams`, `players`, `player_team_history`, `gameweeks`, `fixtures` (grouping
fixtures by api-football's `round` string into gameweeks, deriving a numeric gameweek
number from the round name where possible) → updates the `sync_runs` row with
`status: success/failed` and `records_processed`.

Response: `{ success: true, processed, competitionId, competitionName, season }` or
`{ error, competitionId }` with status `500`.

### `POST /functions/v1/compute-deadlines`
**Auth:** requires either the service-role key or a signed-in `app_admin`
session (see `sync-fixtures` above — same helper, same fix, resolves
[current-state.md ISSUE-26](./current-state.md#issue-26--compute-deadlinescompute-scoressettle-gameweeksync-fixtures-accepted-unauthenticated-requests)).
No request body used. For every `upcoming`/`live` gameweek,
finds the earliest non-postponed/cancelled fixture kickoff and sets
`earliest_kickoff_utc` to it and `deadline_utc` to 30 minutes before it. Response:
`{ success: true, updated }`.

### `POST /functions/v1/compute-scores`
**Auth:** requires either the service-role key or a signed-in `app_admin`
session (see `sync-fixtures` above — same helper, same fix, resolves
[current-state.md ISSUE-26](./current-state.md#issue-26--compute-deadlinescompute-scoressettle-gameweeksync-fixtures-accepted-unauthenticated-requests)).
No request body used. Creates a `sync_runs` row
(`job_name: 'compute-scores'`). For every `upcoming`/`live` gameweek: determines
`isLive` (any fixture in that gameweek has `status = 'live'`), then for every
`user_entries` row in that gameweek:
- if the matching `entry_payments.is_paid` is falsy, voids the entry
  (`is_void = true`) and sets all its picks' `result = 'void'`, then skips scoring
  (see [current-state.md ISSUE-6](./current-state.md#issue-6--payment-verification-has-no-ui-or-bulk-import-compute-scoressettle-will-void-every-entry)
  for why this currently voids everything);
- otherwise, for each pick, sums `player_fixture_goals.goals` for that player/gameweek
  and compares against `goal_threshold` to set `result` to one of `winning/losing` (if
  `isLive`) or `won/lost` (otherwise), and updates `user_entries.picks_won`/`status`
  (`locked` if live, `settled` if not) accordingly.

Reads from the `player_fixture_goals` **materialized view**, whose freshness is
unverified — see [current-state.md ISSUE-3](./current-state.md#issue-3--player_fixture_goals-materialized-view-is-never-refreshed).

Response: `{ success: true, processed }` or `{ error }` with `500` (and the
`sync_runs` row marked `failed`).

### `POST /functions/v1/settle-gameweek`
**Auth:** requires either the service-role key or a signed-in `app_admin`
session (see `sync-fixtures` above — same helper, same fix, resolves
[current-state.md ISSUE-26](./current-state.md#issue-26--compute-deadlinescompute-scoressettle-gameweeksync-fixtures-accepted-unauthenticated-requests)
— previously doubly notable here since the body's `gameweek_id` had no
ownership check either). Optional body: `{ gameweek_id }` to target one gameweek,
otherwise scans every gameweek with `status != 'completed'`. For a gameweek where
every non-postponed/cancelled fixture is `finished`: marks all its (non-void)
`user_entries` as `settled`, marks the gameweek `completed`, then for each pot with
entries in that gameweek, ranks members by `picks_won` descending and upserts one
`leaderboard_snapshots` row per member with `is_overall: false` — always, see
[current-state.md ISSUE-15](./current-state.md#issue-15--overall-cross-gameweek-leaderboard-is-never-populated).
Response: `{ success: true }` (no per-gameweek detail).

### Referenced but not implemented: `sync-live-events`
`003_cron_jobs.sql` schedules a call to `/functions/v1/sync-live-events` every 2
minutes, and `AdminDashboard.jsx` has a "Sync live events" button that calls
`useTriggerSync('sync-live-events')`. No `supabase/functions/sync-live-events/`
directory exists in the repo, so calling this today would return a `404` from
Supabase's functions gateway. Live-verification status, and what fills this gap
today: [current-state.md ISSUE-4](./current-state.md#issue-4--sync-live-events-edge-function-is-referenced-but-doesnt-exist).

## 3. External APIs consumed

| Provider | Consumed by | Auth | Wired into the running app? |
|---|---|---|---|
| api-football v3 (`v3.football.api-sports.io`) | `supabase/functions/sync-fixtures` | `x-rapidapi-key` header, `VITE_FOOTBALL_DATA_KEY` env var | Yes — the only provider on cron |
| football-data.org v4 (`api.football-data.org/v4`) | `frontend/src/lib/footballDataProvider.js` (unused), `frontend/scripts/{fullSyncInsert,fullSyncPlayers,syncFootballData}.js` (manual scripts) | `X-Auth-Token` header | No — manual/backfill scripts only, see [current-state.md ISSUE-12](./current-state.md#issue-12--overlapping-unused-football-dataorg-sync-scripts) |
| WhoScored.com (HTML scraping via Playwright, no official API) | `frontend/scripts/{ws-live-events,sync-whoscored-*}.js` | none (unauthenticated scrape, spoofed `User-Agent`, persistent Chrome profile) | Manually, by running a script locally — see [architecture.md § Three football data providers](./architecture.md#three-football-data-providers) |

Why three providers exist and what that implies architecturally:
[architecture.md § Three football data providers](./architecture.md#three-football-data-providers).
Why the intended provider-abstraction layer was never finished:
[decisions.md § Provider abstraction was planned but never completed](./decisions.md#provider-abstraction-was-planned-but-never-completed).
