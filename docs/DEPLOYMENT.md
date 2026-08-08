# Deployment Guide

Last reviewed: 2026-08-06. Consolidates operational requirements discovered and
proven across `current-state.md`, `session-log.md`, `deployment-checklist.md`
(the ISSUE-19/20/21-specific historical execution log this document does not
replace), and the Production Hardening Sprint. Every item below traces back to
something actually observed or executed against this project — nothing here is
generic deployment advice invented for this document.

See also: [deployment-checklist.md](./deployment-checklist.md) (the detailed,
phase-by-phase historical record of the ISSUE-19/20/21 remediation, including
what's already been executed and verified), [current-state.md](./current-state.md)
(the live issue register), [game-engine.md](./game-engine.md) (architecture).

---

## Environment setup

- **Supabase CLI**: `2.111.0`, confirmed via `supabase --version` (installed at
  `~/scoop/shims/supabase` in this project's dev environment; invoked via `npx
  supabase` also works and resolves the same version).
- **Postgres**: major version `17` (`supabase/config.toml` § `[db]`).
- **Docker**: local development requires Docker Desktop with the containers
  named `*_pl-goals` (project ID `pl-goals`). `supabase_vector_pl-goals`
  restart-looping is a known, non-blocking Windows/Docker-Desktop limitation —
  not a sign of a broken stack.
- **New Edge Function directories require a full `supabase stop` / `supabase
  start` cycle, not just a container restart.** Confirmed twice (LMS Slice 1,
  Score Predictor Slice 1): a brand-new function directory is not picked up by
  the local Edge Runtime with a plain `docker restart`. Editing an *existing*
  function's code only needs `docker restart supabase_edge_runtime_pl-goals`
  followed by `docker restart supabase_kong_pl-goals` (Kong caches stale
  container IPs).
- **Known ownership limitation — read this before attempting any RLS or cron
  change.** This project has two distinct Postgres roles with disjoint
  privilege: `postgres` (owns everything created via `supabase/migrations/`)
  and `supabase_admin` (owns objects created out-of-band, e.g. via the
  Supabase Studio Table Editor or Dashboard). `postgres` **cannot** `ALTER`,
  `DROP`, or effectively `REVOKE` privileges on anything `supabase_admin`
  owns — confirmed empirically, live, twice (once for tables during the
  ISSUE-20/21 investigation, once for `cron.job` rows during the Production
  Hardening Sprint). `supabase_admin` is the only role that is both
  `rolsuper` and `rolbypassrls`. See "Known platform limitations" below for
  the full list of affected objects.

---

## Post-provision checklist

Actions that **cannot** be performed by `supabase/migrations/` on a freshly
provisioned project, because they require `supabase_admin`-equivalent
privilege that the migration-running `postgres` role does not have. Run these
once, immediately after provisioning, before relying on the project for real
data.

- [ ] **Check for `supabase_admin`-owned objects.** Run:
  ```sql
  select relname, relowner::regrole from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
  and relowner::regrole::text != 'postgres';
  select jobid, jobname, username from cron.job where username != 'postgres';
  ```
  If either query returns rows, this environment has the same out-of-band
  ownership split this project's own dev/staging environment has had since
  before Milestone 2 — proceed with the remaining checklist items. If both
  return zero rows, this environment is clean and most of this checklist can
  be skipped (still worth confirming RLS state directly, below).
- [ ] **Enable RLS and lock down every `supabase_admin`-owned table.** Requires
  a direct connection as `supabase_admin` (or an equivalent superuser) — a
  normal `postgres`-run migration will hard-fail
  (`ERROR: must be owner of table ...`). Tested SQL (this project's own
  7 affected tables — adjust the table list if a fresh provision has
  different out-of-band objects):
  ```sql
  -- Tables with no legitimate application code reference — full lockdown.
  alter table public.gameweek_pots enable row level security;
  alter table public.lms_entries enable row level security;
  alter table public.lms_picks enable row level security;
  alter table public.predictor_entries enable row level security;
  alter table public.predictor_picks enable row level security;
  alter table public.whoscored_fixture_map_staging enable row level security;
  revoke all on public.gameweek_pots from anon, authenticated;
  revoke all on public.lms_entries from anon, authenticated;
  revoke all on public.lms_picks from anon, authenticated;
  revoke all on public.predictor_entries from anon, authenticated;
  revoke all on public.predictor_picks from anon, authenticated;
  revoke all on public.whoscored_fixture_map_staging from anon, authenticated;

  -- fixture_player_status IS read by the frontend (hooks/useEntry.js,
  -- hooks/useLiveScores.js) — needs a real SELECT policy, not a full
  -- lockdown. Mirrors the exact pattern fixtures/teams/players already use.
  alter table public.fixture_player_status enable row level security;
  create policy "reference_data_read_fixture_player_status"
    on public.fixture_player_status for select
    to authenticated
    using (true);
  revoke insert, update, delete, truncate, references, trigger on public.fixture_player_status from anon, authenticated;
  revoke select on public.fixture_player_status from anon;
  ```
  Before running this against a table not on this project's known list,
  **grep the codebase for the table name first** (`grep -rln "<table>"
  supabase/ frontend/src/`) — if any code reads it, it needs a real SELECT
  policy (mirror the `fixture_player_status` shape above), not a full
  lockdown.
- [ ] **Verify the RLS fix.** As an authenticated client: confirm any
  legitimately-read table (e.g. `fixture_player_status`) still returns
  successfully. As the anonymous role: confirm both read and write are now
  denied (`permission denied for table ...`) on every locked-down table.
- [ ] **Check for orphaned/duplicate `supabase_admin`-owned cron jobs.**
  `006_fix_cron_job_headers.sql`'s own `cron.unschedule()` calls only
  succeed for jobs `postgres` owns — a job created out-of-band (like this
  project's own `sync-live-events-every-5-min` was) will silently fail to
  unschedule, masked by that migration's own `exception when others then
  null` guard. Check: `select jobid, jobname, username, active from
  cron.job;` — cross-reference job names against `003_cron_jobs.sql`/
  `006_fix_cron_job_headers.sql`'s intended final state. Unschedule any
  stray `supabase_admin`-owned job directly: `psql -U supabase_admin -c
  "select cron.unschedule('<jobname>');"`.
- [ ] **Apply `app.settings.*` GUCs** (`ISSUE-19` — required for every
  cron-driven `net.http_post()` call to construct a valid URL/auth header):
  ```sql
  alter database postgres set app.settings.supabase_url = '<this project's URL>';
  alter database postgres set app.settings.service_role_key = '<this project's service role key>';
  ```
  Verify: `select current_setting('app.settings.supabase_url'),
  current_setting('app.settings.service_role_key') is not null;` — must not
  error.

---

## Deployment checklist

- [ ] **Migrations.** Apply `supabase/migrations/001` through the latest, in
  order, via the normal `postgres`-owned migration path (`supabase db push`
  or the CLI's standard apply flow). All 16 migrations as of this document
  are confirmed applied, in order, on this project's own dev database
  (`supabase_migrations.schema_migrations`).
- [ ] **Edge Functions.** Deploy every directory under `supabase/functions/`
  except `_shared/` (which is imported by the others, not deployed itself).
  Current inventory: `admin-actions`, `compute-deadlines`, `compute-scores`,
  `get-or-create-lms-entry`, `get-or-create-pick5-entry`,
  `get-or-create-predictor-entry`, `settle-gameweek`, `submit-lms-pick`,
  `submit-pick5-picks`, `sync-fixtures`. Note: `sync-live-events` does **not**
  exist yet (`ISSUE-4`) — the cron job that targets it will 404 until it's
  built; this is expected, not a deployment failure.
- [ ] **Cron jobs.** `003_cron_jobs.sql` + `006_fix_cron_job_headers.sql`
  register: `sync-fixtures-daily`, `compute-deadlines-hourly`,
  `compute-scores-every-3-min`, `settle-gameweek-every-30-min`,
  `sync-live-events-every-2-min` (expected to 404 until `ISSUE-4`). Complete
  the Post-provision checklist above first — a fresh project may also have
  out-of-band jobs (`lock-due-entries-every-minute` on this project's own
  environment) that migrations never registered and cannot manage.
- [ ] **Secrets/environment variables**, per Edge Function's own
  `Deno.env.get()` calls: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (every
  function), `SUPABASE_ANON_KEY` (functions that resolve caller identity via
  a user-scoped client — all except `compute-deadlines`/`compute-scores`/
  `settle-gameweek`, which are service-role-only cron targets).
  `sync-fixtures` additionally needs `FOOTBALL_DATA_KEY`
  (`football-data.org` API key, per `.env`'s own `FOOTBALL_DATA_KEY`/
  `FOOTBALL_SEASON`/`FOOTBALL_COMPETITION_CODE`). On hosted Supabase these
  first three are typically available to Edge Functions automatically; verify
  rather than assume for a self-hosted target.
- [ ] **RLS verification** — see Post-provision checklist above; do this
  *before* declaring the deployment complete, not as an afterthought.
- [ ] **Smoke tests.** This project's own live-verification scripts
  (constructed fresh per slice throughout this project, never checked into
  the repo as permanent fixtures) follow one consistent shape: create 1–2
  real test users via `auth.admin.createUser()`, create a real pot via a
  direct table insert, exercise the target Edge Function or `GameEngine`
  method over real HTTP or via direct module import, assert on the real
  resulting database state, then delete every created row by exact ID and
  re-verify zero rows remain. At minimum, confirm: entry creation succeeds
  and is idempotent for each mode (`get-or-create-{pick5,lms,predictor}-entry`);
  a pick submission succeeds through `submit-{pick5,lms}-pick`; the cron
  chain (`compute-deadlines` → `compute-scores` → `settle-gameweek`)
  completes without error against a seeded gameweek.

---

## Operational checks

**Expected scheduled jobs** (confirmed live on this project's own environment;
adjust only if this project's own cron registration changes):

| Job | Schedule | Calls |
|---|---|---|
| `lock-due-entries-every-minute` | `* * * * *` | `public.lock_due_entries()` — a plain SQL function on the retired prototype schema, not an Edge Function; harmless, operates on frozen legacy data (`ISSUE-20`/`21` territory, `supabase_admin`-owned) |
| `sync-fixtures-daily` | `0 5 * * *` | `sync-fixtures` |
| `compute-deadlines-hourly` | `0 * * * *` | `compute-deadlines` |
| `compute-scores-every-3-min` | `*/3 * * * *` | `compute-scores` |
| `settle-gameweek-every-30-min` | `*/30 * * * *` | `settle-gameweek` |
| `sync-live-events-every-2-min` | `*/2 * * * *` | `sync-live-events` — **expected to 404**, function not built yet (`ISSUE-4`) |

A cron job reporting `succeeded` in `cron.job_run_details` only proves the SQL
statement (queuing the `net.http_post` call) didn't error — it does **not**
prove the downstream HTTP call succeeded, since `pg_net` processes requests
asynchronously. Always cross-check `net._http_response` for the actual status
code when diagnosing a suspected cron problem.

**Expected notifications** (one row in `notifications` per event, both modes
use the identical insert shape):
- `pick5.prize_awarded` — one per actual winner, written from within
  `Pick5Engine.awardPrize()`, after its trailing `pot_prizes` write.
- `lms.prize_awarded` — one per actual payout recipient (single survivor,
  wipeout split, season-end split), written the same way from
  `LmsEngine.awardPrize()`. **No** notification for a `roll_prize` wipeout
  (nobody is paid) — this is correct, not a gap.
- Neither mode's `awardPrize()` currently sends any notification for a
  rollover event itself (LMS) or for a `Pick5PrizePoolExceededError`/
  `Pick5NoEligibleWinnersError`/`LmsFinalPredictionNotImplementedError`
  failure — these surface only as a thrown error from the Edge Function,
  visible in its response body and (if cron-triggered) `sync_runs`/
  `net._http_response`, not as a user-facing notification.

**Expected settlement behavior:**
- Pick 5: settles per gameweek — `settle()` → `generateStandings()` →
  `awardPrize()`, once per pot with entries in that gameweek, every time
  `settle-gameweek` runs against a newly-finished gameweek.
- LMS: `settle()` runs every gameweek (payment-void check), but
  `awardPrize()` only produces a real outcome once the competition has
  actually concluded (single survivor, wipeout, or season-end tie) — most
  calls are a correct, silent no-op. Once concluded, the pot is excluded
  from all future `calculateScore()`/`settle()` processing
  (`getEligibleLmsPotIds()`'s settled-`pot_prizes` filter).
- Score Predictor: not yet implemented beyond entry creation (Milestone 6
  Slice 1). No settlement behavior exists yet.

---

## Recovery procedures

**Retry expectations — what's safe to simply re-invoke:**
- `lockEntries()`, `calculateScore()`, `generateStandings()` (both modes):
  fully idempotent, safe to re-run from any failure point at any time — each
  recomputes from current source state rather than incrementing.
- `settle()` (both modes): safe to retry as of the Production Hardening
  Sprint's fix — unpaid entries' picks are voided *before* the entry itself,
  so a failure partway through never strands an entry outside the
  status filter a retry depends on.
- `awardPrize()` (both modes): safe to retry as of the same fix — the
  `pot_prizes` write (the idempotency gate) now runs *last*, after every
  other write in the method, so a partial failure never leaves the
  idempotency gate falsely tripped. `LmsEngine`'s `createRolloverPot()`
  additionally self-guards against creating a duplicate rollover pot if
  retried after already having succeeded once.
- **Cron jobs generally**: every job above is written to be safely
  re-invoked by its next scheduled tick with no manual intervention, given
  the retry-safety above. A single missed or failed tick is not an incident.

**Known manual intervention scenarios** (require direct database/Dashboard
access, not just re-running a cron job):
- **RLS exposure on a `supabase_admin`-owned table** — see Post-provision
  checklist. Cannot self-heal; requires a human with `supabase_admin`
  privilege.
- **An orphaned/duplicate `supabase_admin`-owned cron job** — same
  privilege requirement, see Post-provision checklist.
- **`app.settings.*` GUCs unset or pointing at the wrong project** — every
  cron-driven Edge Function call will fail with a null-URL constraint
  violation (visible immediately in `cron.job_run_details`). Fix: re-run the
  `alter database` statements in the Post-provision checklist.
- **A gameweek's `deadline_utc` looks wrong** — `ISSUE-24`: an undocumented,
  `supabase_admin`-owned trigger recomputes it from `fixtures` with a 15-minute
  offset, conflicting with `compute-deadlines`' own documented 30-minute
  rule. Confirmed live, unresolved, blocked on a product decision (which
  offset is actually correct). Do not "fix" by editing `compute-deadlines`
  without first resolving which rule is intended.

---

## Known platform limitations

- **`supabase_admin` ownership** — the following objects, on this project's
  own environment, are owned by `supabase_admin`, not `postgres`, and
  therefore cannot be altered by any migration: the 7 prototype tables
  (`fixture_player_status`, `gameweek_pots`, `lms_entries`, `lms_picks`,
  `predictor_entries`, `predictor_picks`, `whoscored_fixture_map_staging`),
  2 `game_type`/`predictor_cycle_mode`-adjacent enum types (already renamed
  to `*_prototype_deprecated` per `deployment-checklist.md` Phase 4), 11
  prototype functions, 1 debug view, and (discovered during the Production
  Hardening Sprint) at least 2 `cron.job` rows
  (`lock-due-entries-every-minute`, and formerly
  `sync-live-events-every-5-min`, now removed). Most likely origin: created
  via Supabase Studio's Table Editor/Dashboard, which executes as
  `supabase_admin` rather than the project's own `postgres` credential.
- **Migration limitations** — a migration is always run as `postgres`. Any
  SQL statement targeting a `supabase_admin`-owned object will hard-fail
  (`must be owner of ...`), and — as `006_fix_cron_job_headers.sql`
  demonstrated — a broad `exception when others then null` guard around such
  a statement will silently swallow that failure rather than surface it,
  giving false confidence that a fix took effect. Any future migration
  touching a table/function/cron job should check ownership first
  (`select ... ::regrole` / `select username from cron.job`) rather than
  assume `postgres` can act on it.
- **Prototype tables** — isolated, not deleted, per the explicit "isolate,
  don't delete yet" decision (`ISSUE-20`). Final removal is
  `deployment-checklist.md` Phase 8, gated behind two clean rounds of
  verification, not yet executed.
- **Remaining P2 items** (documented, not acted on — see `current-state.md`/
  `session-log.md` for full detail): `submit-lms-pick`'s pre-write
  race-check re-verifies `entry.status`, not LMS's actual submission gate
  (the live gameweek deadline) — a narrow, single-request-latency window,
  no data corruption possible. `admin-actions`' `mark_unpaid` writes to the
  legacy `user_entries` table with its result unchecked — dead code, nothing
  reads it. `compute-scores`/`settle-gameweek` still run the retired
  prototype's `user_entries`-based scoring in parallel with the Game Engine
  dispatch, against 1 stale pre-cutover row. Several foreign-key columns
  across the schema have no covering index — no evidence of an actual slow
  query at current data volumes.
