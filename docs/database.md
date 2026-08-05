# Database

Last reviewed: 2026-08-03. Source: `supabase/migrations/001_initial_schema.sql`,
`002_rls_policies.sql`, `003_cron_jobs.sql`, `supabase/seed/seed_season.sql`.

This is reference material — it describes what's defined in versioned migrations, and
changes only when a migration is added. It does **not** track whether the live
Supabase database actually matches these files (see
[Schema drift](#schema-drift) below) or whether any given piece of schema is working
correctly in production — that tracking lives in
[current-state.md](./current-state.md), linked by `ISSUE-N` throughout this document.

See also: [architecture.md](./architecture.md) (how this schema fits into the wider
system), [api.md](./api.md) (what reads/writes it via edge functions).

Engine: Postgres 17 (`supabase/config.toml`, `major_version = 17`). Extensions:
`uuid-ossp`, `pg_cron`, `pg_trgm`.

**Not yet reflected below:** `004_game_engine_shared_platform.sql` and
`005_game_engine_shared_platform_rls.sql` exist in `supabase/migrations/` but have
not been applied to the live database (blocked by
[current-state.md ISSUE-21](./current-state.md#issue-21--postgres-role-cannot-alter-supabase_admin-owned-prototype-objects))
and are not described in this document yet. See [game-engine.md](./game-engine.md)
for the schema they define and [schema-review.md](./schema-review.md) for the design
review behind their current form.

## Enums

| Type | Values |
|---|---|
| `pot_status` | active, archived, draft |
| `gameweek_status` | upcoming, live, completed, postponed |
| `fixture_status` | scheduled, live, finished, postponed, cancelled, tbd |
| `entry_status` | pending, locked, void, settled |
| `pick_result` | pending, winning, losing, won, lost, void |
| `sync_status` | running, success, failed, partial |
| `member_role` | admin, member |

## Tables

### `profiles`
One row per `auth.users` row (1:1, `id` is both PK and FK to `auth.users.id`,
`on delete cascade`). Auto-created by the `handle_new_user()` trigger on signup.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | = auth.users.id |
| username | text, unique | 3–30 chars, `^[a-zA-Z0-9_]+$` |
| display_name | text | 1–60 chars |
| avatar_url | text | nullable |
| timezone | text | default `'UTC'` |
| created_at / updated_at | timestamptz | updated_at auto-maintained by trigger |

### `seasons`
| Column | Notes |
|---|---|
| id | bigserial PK |
| name, year_start, year_end | e.g. "2026/27", 2026, 2027 |
| is_current | boolean; **partial unique index** ensures at most one row has `is_current = true` |
| unique (year_start, year_end) | |

### `leagues`
Belongs to a season. `unique (provider_id, provider_name, season_id)` — the same
league from the same provider can exist once per season (re-synced each season).

### `teams`
Belongs to a season + league. `unique (provider_id, provider_name, season_id)` — a
team is re-created per season (supports mid-season transfers/promotion correctly, at
the cost of `teams.id` not being stable across seasons).

### `players`
Provider-global, **not** season-scoped. `unique (provider_id, provider_name)`. Has a
`gin_trgm_ops` index on `display_name` for fuzzy/partial search.

### `player_team_history`
Join table: which team a player belonged to in which season, with `is_active`,
`joined_at`/`left_at`, `shirt_number`. `unique (player_id, team_id, season_id)`. This
is how "which team is this player on right now" is resolved (`is_active = true`) — it
allows a player to be re-assigned mid-season by inserting a new row.

### `gameweeks`
Belongs to season + league. `number` constrained 1–38 (Premier-League-shaped; a cup
competition with more or fewer rounds would need a different check or `number` reused
loosely — see `sync-fixtures`' `parseRoundNumber`/fallback-counter logic, which copes
with non-numeric round names like "Quarter-final"). `is_current` has the same
single-true partial unique index pattern as `seasons`. `deadline_utc` and
`earliest_kickoff_utc` are computed, not synced directly (see `compute-deadlines`,
documented in [api.md](./api.md#post-functionsv1compute-deadlines)).

### `fixtures`
Belongs to a gameweek; `home_team_id`/`away_team_id` FK to `teams`, with a check that
they differ. `provider_raw jsonb` stores the full api-football payload for debugging/
future re-derivation. `unique (provider_id, provider_name)`.

### `fixture_events`
Goals, cards, etc. within a fixture. `event_type` is a free-text column (not an enum)
— values currently produced by the WhoScored scraper scripts are `goal`, `yellow_card`,
`red_card`, `second_yellow`, `substitution`, `missed_penalty` (see `EVENT_TYPE_MAP` in
`frontend/src/lib/whoScored.js` and `frontend/scripts/ws-live-events.js`), but nothing
in the schema constrains this, so the value space is whatever the ingestion code
decides to write. `unique (fixture_id, provider_id)` enables idempotent upserts from
scrapers/syncs.

### `pots`
A private group. `invite_code text unique` exists on the table but is currently
unused by any frontend code — see
[current-state.md ISSUE-8](./current-state.md#issue-8--no-self-serve-pot-join-flow).

### `pot_members`
Join table `(pot_id, user_id)`, `role` is `admin` or `member`. `unique (pot_id, user_id)`.
See [Row Level Security summary](#row-level-security-summary) below for the insert
policy on this table, which has a known circularity for first-member inserts
([current-state.md ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy)).

### `entry_payments`
Tracks whether a member has paid their entry fee for a given `(pot, user, gameweek)`.
Auto-created (unpaid) whenever a `user_entries` row is inserted, via the
`create_entry_payment()` trigger. Marked paid/unpaid only through the `admin-actions`
edge function (`mark_paid`/`mark_unpaid`), which — for `mark_unpaid` — also forces the
matching `user_entries` row to `is_void = true, status = 'void'`. See
[api.md § admin-actions](./api.md#post-functionsv1admin-actions) for the full
request/response contract, and
[current-state.md ISSUE-6](./current-state.md#issue-6--payment-verification-has-no-ui-or-bulk-import-compute-scoressettle-will-void-every-entry)
for why this currently has no UI.

### `user_entries`
One row per `(pot, user, gameweek)` — a member's entry for that gameweek.
`picks_total` defaults to 5 (the fixed pick count). `is_void` excludes the entry from
scoring (set when payment is marked unpaid, or manually).

### `user_entry_picks`
The 1–5 player picks belonging to an entry. `pick_position` 1–5, `unique (entry_id,
pick_position)`. `goal_threshold` defaults to 1 but is **automatically recomputed** by
the `recompute_goal_thresholds()` trigger (fires after insert/delete on this table) to
equal the count of rows with the same `(entry_id, player_id)` — i.e. picking the same
player N times sets that player's threshold to N goals needed. `result` defaults to
`pending` and is written by `compute-scores` (see
[api.md § compute-scores](./api.md#post-functionsv1compute-scores)). Design rationale
and a trap for future code (partial `UPDATE`s bypass this trigger): see
[decisions.md § Duplicate-pick scoring model](./decisions.md#duplicate-pick-scoring-model-goal-thresholds-via-trigger).

### `leaderboard_snapshots`
Denormalized per-gameweek and overall (`is_overall = true`, `gameweek_id is null`)
rank rows, written by `settle-gameweek`. `unique (pot_id, gameweek_id, user_id)`. As of
the current `settle-gameweek` implementation, **only per-gameweek snapshots are
written** (`is_overall: false` always) — see
[current-state.md ISSUE-15](./current-state.md#issue-15--overall-cross-gameweek-leaderboard-is-never-populated).

### `sync_runs`
Audit log for both edge-function-driven and cron-driven sync jobs: `job_name`,
`status`, `started_at`/`finished_at`, `records_processed`, `errors jsonb`,
`triggered_by` (`'cron'`, `'manual'`, or a specific user).

## Views

### `available_players_by_gameweek` (view)
The core "which players can be picked for gameweek X" query: joins active
`player_team_history` → `teams` → `fixtures` (excluding postponed/cancelled) →
`gameweeks`. This is intended to be the single source of truth for player eligibility
across the app, and is queried directly by `hooks/usePlayers.js`, `lib/gameAPI.js`,
`pages/PotDetail.jsx`, and `components/pot/potManager.jsx` — but `PotDetail.jsx`
additionally hardcodes `.neq('position', 'Goalkeeper')` on top of it, a business rule
that exists only in that one component. See
[current-state.md ISSUE-7](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules)
for the consequence.

### `player_fixture_goals` (materialized view)
Per-player, per-fixture, per-gameweek goal counts, derived from `fixture_events`
(counts `event_type in ('goal','penalty')` excluding own goals). Refreshed via the
`refresh_player_fixture_goals()` function (`refresh materialized view concurrently`,
falling back to a non-concurrent refresh if the concurrent form isn't supported — e.g.
before the required unique index exists). This function is defined but nothing in the
repository calls it — see
[current-state.md ISSUE-3](./current-state.md#issue-3--player_fixture_goals-materialized-view-is-never-refreshed)
for what depends on it and why that matters.

## Functions & triggers

| Function | Trigger | Purpose |
|---|---|---|
| `set_updated_at()` | before update, most tables | maintains `updated_at` |
| `recompute_goal_thresholds()` | after insert/delete on `user_entry_picks` | derives `goal_threshold` from pick count |
| `create_entry_payment()` (`security definer`) | after insert on `user_entries` | seeds an unpaid `entry_payments` row |
| `handle_new_user()` (`security definer`) | after insert on `auth.users` | seeds `profiles` from signup metadata |
| `refresh_player_fixture_goals()` | none (must be called manually/by a job) | refreshes the materialized view |

RLS helper functions (all `security definer`, used only inside policy definitions):

- `is_pot_member(p_pot_id uuid) returns boolean` — exists a `pot_members` row for
  `(p_pot_id, auth.uid())`.
- `is_pot_admin(p_pot_id uuid) returns boolean` — exists a `pot_members` row for
  `(p_pot_id, auth.uid())` with `role = 'admin'`.
- `is_app_admin() returns boolean` — `auth.jwt() -> 'app_metadata' ->> 'role' =
  'app_admin'`.

## Row Level Security summary

RLS is enabled on every table. Policy shape, table by table:

| Table | select | insert | update | delete |
|---|---|---|---|---|
| profiles | any authenticated user | self only | self only | — |
| seasons/leagues/teams/players/player_team_history/gameweeks/fixtures/fixture_events | any authenticated user | — | — | — |
| pots | pot members only | any authenticated user, `created_by = auth.uid()` | pot admin or app admin | — |
| pot_members | pot members only | pot admin or app admin ⚠️ | pot admin or app admin | self, pot admin, or app admin |
| entry_payments | pot members only | pot admin or app admin | pot admin or app admin | — |
| user_entries | pot members only | self, and must already be a pot member | self, only while `status = 'pending'` | — |
| user_entry_picks | pot members only (via entry → pot) | self, only while entry is `pending` | self, only while entry is `pending` | self, only while entry is `pending` |
| leaderboard_snapshots | pot members only | — | — | — |
| sync_runs | app admin only | — | — | — |

⚠️ The exact policy on `pot_members` inserts:

```sql
create policy "pot_members_insert_admin"
on public.pot_members for insert
to authenticated
with check (public.is_pot_admin(pot_id) or public.is_app_admin());
```

`is_pot_admin(pot_id)` requires an *existing* `pot_members` row with `role = 'admin'`
for that pot — which cannot exist yet for a brand-new pot's first member. Both
pot-creation code paths in the frontend (`hooks/usePots.js:useCreatePot`,
`components/pot/potManager.jsx:handleCreatePot`) insert the creator as `admin`
immediately after creating the pot, which this policy appears to reject for any user
who isn't already an app admin. Live-verification status and fix options:
[current-state.md ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy).

No table has an UPDATE or DELETE policy for reference data (seasons/leagues/teams/
players/etc.) or for `fixtures`/`fixture_events` — those are only ever written by
edge functions using the service-role key, which bypasses RLS entirely.

## Cron jobs (`003_cron_jobs.sql`)

| Job | Schedule | Calls |
|---|---|---|
| sync-fixtures-daily | `0 5 * * *` (05:00 UTC daily) | `sync-fixtures` |
| sync-live-events-every-2-min | `*/2 * * * *` | `sync-live-events` — function not present in the repo, see [current-state.md ISSUE-4](./current-state.md#issue-4--sync-live-events-edge-function-is-referenced-but-doesnt-exist) |
| compute-deadlines-hourly | `0 * * * *` | `compute-deadlines` |
| compute-scores-every-3-min | `*/3 * * * *` | `compute-scores` |
| settle-gameweek-every-30-min | `*/30 * * * *` | `settle-gameweek` |

All jobs call `net.http_post` against `<supabase_url>/functions/v1/<name>` with the
service-role key as a bearer token, sourced from Postgres settings
(`app.settings.supabase_url` / `app.settings.service_role_key`) that must be
configured separately — they are not set anywhere in these migrations, likely set via
`ALTER DATABASE ... SET` in the Supabase dashboard or a setup step not captured in
version control. Full function-by-function behavior: [api.md](./api.md).

## Schema drift

Code in the repository references the following objects, which are **not** defined in
any migration file. Either the deployed database has manually-applied changes not
captured in `supabase/migrations/`, or these code paths are unfinished/broken — see
[current-state.md](./current-state.md) for live-verification status on each.

- **Table `fixture_player_status`** — columns implied by usage: `player_id`,
  `fixture_id`, `status` (`starting`/`bench`/`sub_on`/`sub_off`/`not_in_squad`),
  `started`, `came_on_minute`, `went_off_minute`. Read by
  `hooks/useEntry.js:useFixturePlayerStatuses`, subscribed to by
  `hooks/useLiveScores.js`, rendered by `GameweekPage.jsx` — this is live, reachable
  frontend code, not dead code. See
  [current-state.md ISSUE-2](./current-state.md#issue-2--fixture_player_status-table-missing-from-migrations).
- **Column `fixtures.whoscored_fixture_id`** — read by `frontend/src/lib/whoScored.js`
  / `frontend/scripts/ws-live-events.js` to map a WhoScored match ID to a local
  fixture.
- **Column `teams.whoscoredteamid`** (or similar) — written by
  `frontend/scripts/sync-whoscored-teamids.js`.
- **RPC `get_or_create_entry(p_pot_id, p_gameweek_id)`** and **RPC
  `save_entry_picks(p_entry_id, p_player_ids)`** — called from
  `frontend/src/lib/gameAPI.js`, which is dead code (only imported by the also-dead
  `components/entryBuilder.jsx`, and even that import is broken — see
  [current-state.md ISSUE-11](./current-state.md#issue-11--dead-code-including-a-latent-case-sensitivity-import-bug)).
  Lower priority than the `fixture_player_status` gap since this path is unreachable
  from the running app today.

Before writing any migration that touches `fixture_player_status` or the WhoScored-
related columns, check the live Supabase project's schema first — it may already have
them, in which case the fix is to add a migration that captures the existing state,
not to invent a new shape from scratch.
