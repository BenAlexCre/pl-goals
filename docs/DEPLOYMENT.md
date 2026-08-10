# Deployment Guide

Last reviewed: 2026-08-10, Production Readiness Sprint (Staging & Deployment
Audit). Rewritten from the 2026-08-06 version — that version predated Milestone
6 (Score Predictor), Launch Readiness Sprints 1A/1B/2, and several genuine
configuration bugs this sprint found and fixed. Every item below was verified
directly against the current repository (migrations, Edge Function source,
`config.toml`, `.env.example`, the live local database) during this sprint, not
carried forward from the prior version without re-checking.

See also: [deployment-checklist.md](./deployment-checklist.md) (a phase-by-phase
historical execution log of the original ISSUE-19/20/21 remediation — kept as a
record of what was actually done, not a template to re-run), [current-state.md](./current-state.md)
(the live issue register), [game-engine.md](./game-engine.md) (architecture),
[SMOKE-TESTS.md](./SMOKE-TESTS.md) (the companion smoke-test checklist for after
any deployment).

---

## 1. What this project is, for deployment purposes

- **Stack**: React 18 + Vite frontend (static build, deployable anywhere that
  serves static files), Supabase (Postgres 17 + Auth + Edge Functions +
  `pg_cron`/`pg_net`) backend. No custom application server — every backend
  operation is either a direct PostgREST call (gated by RLS) or an Edge
  Function.
- **No Storage buckets required.** Confirmed by grep — no application code
  (frontend or Edge Functions) references `supabase.storage` or any bucket.
  Avatar upload is a documented, unimplemented feature (`profiles.avatar_url`
  exists in the schema; nothing reads or writes it). `config.toml`'s
  `[storage]` block is the untouched CLI default.
- **Three game modes** (Pick 5, Last Man Standing, Score Predictor) share one
  schema and platform (`game_entries` + per-mode child tables). All three are
  fully implemented end to end — organiser lifecycle, player lifecycle, and
  automated scoring/settlement all live-verified for all three modes as of
  the Production Readiness Sprint (2026-08-10).

---

## 2. Required extensions

Declared explicitly in `001_initial_schema.sql`:

- `uuid-ossp`
- `pg_cron`
- `pg_trgm`

**Not declared by any migration, but required and assumed pre-provisioned by
the Supabase platform itself:**

- `pg_net` — every cron job's `net.http_post()` call depends on it. Confirmed
  present in the local dev database's `extensions` schema despite no
  migration creating it — this is a Supabase-platform default (both the CLI's
  local Postgres image and hosted Supabase projects ship it pre-enabled), not
  something this repo provisions.
- `pgcrypto` — same situation; present locally, never explicitly created.

**Action for a fresh project**: on hosted Supabase, both are enabled by
default and this needs no action. On a self-hosted or non-standard Postgres
target, verify both are available before applying migrations —
`001_initial_schema.sql` will fail outright without them (`pg_cron`),
and every cron job will fail silently at the `net.http_post()` call without
`pg_net` (no migration-time error, since nothing calls it until the first
cron tick).

Verify: `select extname from pg_extension where extname in ('pg_net',
'pg_cron', 'pg_trgm', 'uuid-ossp', 'pgcrypto');` — expect all five.

---

## 3. Migrations

`supabase/migrations/001_initial_schema.sql` through `023_pick5_jackpot_rollover.sql`
— **23 migrations**, confirmed applied in full, in order, with zero gaps, on
this project's own local dev database (`select version, name from
supabase_migrations.schema_migrations order by version` — 001 through 023,
no missing or out-of-order entries). This is direct evidence migrations
replay cleanly, not an assumption: this local database's entire schema history
came from exactly this sequential apply process (`supabase start`'s own
fresh-provision-and-migrate flow), not a hand-built or manually-patched
database.

Apply via the standard Supabase CLI migration path (`supabase db push` against
a linked project, or the CLI's local `supabase start` for a fresh local
environment) — no special ordering, flags, or manual intervention required for
the migrations themselves.

**One thing migrations cannot do on a fresh hosted project**: seven prototype
tables from an earlier, retired schema iteration
(`fixture_player_status`, `gameweek_pots`, `lms_entries`, `lms_picks`,
`predictor_entries`, `predictor_picks`, `whoscored_fixture_map_staging`) exist
in *this project's own* database, owned by `supabase_admin` (created
out-of-band, likely via Studio's Table Editor, before migrations existed) —
`002`–`023` never reference them and a genuinely fresh project will simply
not have them at all. **This is not something to recreate on a fresh
deployment** — it's dead prototype schema specific to this project's own
history. If a fresh deployment provisioned from these same migrations somehow
also ends up with unexpected `supabase_admin`-owned objects (e.g. via manual
Studio use before migrations are applied), see § 8 below.

---

## 4. Edge Functions

Every directory under `supabase/functions/` except `_shared/` (a module
imported by the others, never deployed on its own) is a real, deployed
function. Current inventory, 11 functions:

| Function | Purpose | Auth model |
|---|---|---|
| `admin-actions` | `mark_paid`/`mark_unpaid`/`record_payment`/`reinstate_entry`/`bulk_verify_payments`/`add_member`/`remove_member` | Signed-in user; per-action pot-admin or app-admin check inside |
| `compute-deadlines` | Locks entries whose gameweek deadline has passed | Service-role key or signed-in `app_admin` only (`ISSUE-26`) |
| `compute-scores` | Refreshes `player_fixture_goals`, then scores every mode | Service-role key or signed-in `app_admin` only |
| `settle-gameweek` | Finalizes a gameweek: settle → standings → winner → prize → notify, per mode | Service-role key or signed-in `app_admin` only |
| `sync-fixtures` | Pulls fixtures/teams/players from api-football, upserts | Service-role key or signed-in `app_admin` only |
| `get-or-create-pick5-entry` | Pick 5 entry creation (idempotent) | Signed-in user |
| `get-or-create-lms-entry` | LMS entry creation, enforces entry window | Signed-in user |
| `get-or-create-predictor-entry` | Predictor entry creation | Signed-in user |
| `submit-pick5-picks` | Pick 5 pick submission | Signed-in user |
| `submit-lms-pick` | LMS team pick submission | Signed-in user |
| `submit-predictor-picks` | Predictor scoreline/goalscorer submission | Signed-in user |

`sync-live-events` does **not** exist as a function (`ISSUE-4`, still open,
blocked on a product decision between rebuilding it against api-football or
formalizing an alternative). Its cron job (`sync-live-events-every-2-min`)
will `404` on every tick — expected, not a deployment failure; do not treat
a `404` on this specific job as a broken deployment.

---

## 5. Secrets and environment variables

**Verified directly against `Deno.env.get(...)` calls in the Edge Function
source and `import.meta.env.VITE_*` calls in the frontend — not copied from
the prior version of this document, which had two genuine errors (below).**

### Edge Function secrets (set via `supabase secrets set` on a hosted project,
or `supabase/functions/.env` for local CLI dev — **not** the frontend's
`.env`/`.env.local`, a separate mechanism)

| Variable | Required by | Notes |
|---|---|---|
| `SUPABASE_URL` | Every function | Typically auto-available on hosted Supabase; verify rather than assume on a self-hosted target |
| `SUPABASE_SERVICE_ROLE_KEY` | Every function | Also the value `_shared/adminOrCronAuth.ts` compares the `Authorization` header against for the cron-caller path — see § 7 |
| `SUPABASE_ANON_KEY` | `admin-actions`, `get-or-create-{pick5,lms,predictor}-entry`, `submit-{pick5,lms,predictor}-picks`, and (via `_shared/adminOrCronAuth.ts`) `compute-deadlines`/`compute-scores`/`settle-gameweek`/`sync-fixtures` | Used to build a user-scoped client that resolves the caller's own identity/claims. The four cron-gated functions only need it for the *human app-admin* calling path (Manual Jobs buttons) — the service-role-key cron path doesn't touch it — but its absence would silently break Manual Jobs while cron itself kept working, a confusing failure mode worth avoiding by just setting it everywhere |
| `VITE_FOOTBALL_DATA_KEY` | `sync-fixtures` only | **Name confirmed from `sync-fixtures/index.ts` line 28, despite the `VITE_` prefix normally meaning "frontend-only."** This is the api-football.com (`v3.football.api-sports.io`) API key, sent as the `x-rapidapi-key` header. The `VITE_` prefix here is a naming holdover, not a typo to "fix" — renaming it would be a code change, out of this sprint's scope. **`.env.example` previously documented this as plain `FOOTBALL_DATA_KEY` — wrong, fixed this sprint (see § 10).** |
| `COMPETITION_ID` | `sync-fixtures` only, optional | Numeric api-football league ID (e.g. `39` = Premier League, a well-known constant for that service). Falls back to the request body's `competitionId`, then to the literal default `'WC'` (World Cup) if neither is set — **not** `FOOTBALL_COMPETITION_CODE`/`FOOTBALL_SEASON`, which `.env.example` previously (wrongly) documented and which no code reads at all. |

**Confirmed, not assumed, this project's own current local gap**: neither
`supabase/functions/.env` nor any equivalent exists locally, and the Edge
Runtime container has zero `FOOTBALL`/`COMPETITION`-related env vars set —
`sync-fixtures` has never had a working API key in this local environment
(matches its own `sync_runs` history: `failed`, `0 processed`, repeatedly).
This is a known, standing local-dev gap, not something this sprint fixed —
doing so requires a real, paid third-party API key this session doesn't
have. A fresh production deployment must set `VITE_FOOTBALL_DATA_KEY` (and
optionally `COMPETITION_ID`) for `sync-fixtures`/the daily cron job to work
at all.

### Frontend build-time variables (`frontend/.env.local` for local dev; the
equivalent mechanism for your hosting platform — e.g. build-time environment
variables — for a real deployment, since Vite inlines these at build time,
not runtime)

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | The project's public API URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | The public anon key — safe to expose client-side, RLS is the real gate |
| `VITE_FOOTBALL_DATA_KEY` | No, effectively unused | Only referenced by `lib/footballDataProvider.js`, which has zero importers anywhere in the reachable app (`ISSUE-11`/`ISSUE-12`, confirmed dead code). Harmless to leave unset for the frontend build. |

### Database-level configuration (not an env var — a Postgres GUC, set via
`ALTER DATABASE`, not a migration — see § 7 for why)

| Setting | Used by |
|---|---|
| `app.settings.supabase_url` | Every `net.http_post()`-calling cron job |
| `app.settings.service_role_key` | Same — **must exactly match the Edge Runtime's actual `SUPABASE_SERVICE_ROLE_KEY`, see § 7, a critical, previously-undetected failure mode** |
| `app.settings.jwt_secret` / `app.settings.jwt_exp` | Present locally, not currently read by any migration or function found via grep — likely a leftover from an earlier design; harmless to set, not required |

---

## 6. Cron jobs

Registered by `003_cron_jobs.sql` + `006_fix_cron_job_headers.sql`:

| Job | Schedule | Calls | Auth |
|---|---|---|---|
| `sync-fixtures-daily` | `0 5 * * *` | `sync-fixtures` | service-role key, via `app.settings.service_role_key` |
| `compute-deadlines-hourly` | `0 * * * *` | `compute-deadlines` | same |
| `compute-scores-every-3-min` | `*/3 * * * *` | `compute-scores` | same |
| `settle-gameweek-every-30-min` | `*/30 * * * *` | `settle-gameweek` | same |
| `sync-live-events-every-2-min` | `*/2 * * * *` | `sync-live-events` — **expected `404`, function doesn't exist (`ISSUE-4`)** | same |

**Not created by any migration** — `supabase_admin`-owned, created out-of-band
on this project's own environment, present locally but **not guaranteed to
exist on a fresh deployment**:

| Job | Schedule | Calls |
|---|---|---|
| `lock-due-entries-every-minute` | `* * * * *` | `public.lock_due_entries()` — a plain SQL function on the retired prototype schema, not an Edge Function call. Harmless if absent on a fresh project; operates on frozen legacy data no current code path reads. |

A fresh deployment should **not** try to recreate this job — it's specific to
this project's own prototype-era history, not a requirement.

**Dependencies between jobs**: `compute-deadlines` must run before
`compute-scores` can score a gameweek meaningfully (locking is what makes an
entry eligible to be scored as final rather than live); `compute-scores`
must run before `settle-gameweek` can settle a gameweek's final outcome.
The schedule (hourly → every 3 min → every 30 min) already reflects this
ordering loosely, but there's no hard dependency enforced between ticks —
each job independently checks the actual database state (gameweek/fixture
status) rather than assuming the prior job already ran, so a missed or
delayed tick of one doesn't corrupt the next.

**Failure handling**: every job here is safe to simply let retry on its next
scheduled tick — `lockEntries()`/`calculateScore()`/`generateStandings()`
(all modes) are fully idempotent recomputations from current state;
`settle()`/`awardPrize()` (all modes) were hardened during the Production
Hardening Sprint specifically so a partial failure never strands data outside
what a retry expects (see `decisions.md` for the specific fixes). A single
missed or failed tick is not an incident requiring manual intervention.

**A cron job reporting `succeeded` in `cron.job_run_details` only proves the
SQL statement (queuing the async `net.http_post` call) didn't error — it does
NOT prove the downstream HTTP call actually succeeded**, since `pg_net`
processes requests asynchronously and disjointly from the calling
transaction. Always cross-check `net._http_response` for the actual HTTP
status code when diagnosing a suspected cron problem — see § 7 for exactly
why this distinction mattered critically on this project's own environment.

---

## 7. Critical: the service-role-key GUC must match the Edge Runtime's actual key

**Found and fixed during the Production Readiness Sprint's predecessor
(Launch Readiness Sprint 2, 2026-08-10) — the single most important item in
this document.** Every cron-triggered call to `compute-deadlines`/
`compute-scores`/`settle-gameweek`/`sync-fixtures` was silently getting `401`
Unauthorized for an extended period on this project's own local environment,
completely invisible in `cron.job_run_details` (which only reflects the SQL
enqueue succeeding). The cause: the database's `app.settings.service_role_key`
GUC (read by every cron job's `net.http_post()` call, per § 5/§ 6) held a
different literal value than the Edge Runtime container's own
`SUPABASE_SERVICE_ROLE_KEY` environment variable — the exact value
`_shared/adminOrCronAuth.ts` compares the incoming request against. Two
systems that are supposed to share one secret had drifted to two different
values (in this project's specific case: an older-format legacy JWT key on
one side, a newer-format `sb_secret_...` key on the other — a Supabase
CLI key-format transition, not something specific to this project's own
code).

**This is a required, standing verification step for every deployment, not a
one-time historical fix**: after provisioning a fresh project (or after any
key rotation on an existing one), confirm these two values actually match
before trusting the cron pipeline.

```sql
-- Run as supabase_admin (or an equivalent superuser) — postgres itself lacks
-- permission to ALTER a custom database-level GUC, the same ownership split
-- ISSUE-21 documents for other objects.
alter database postgres set app.settings.service_role_key = '<the exact value of SUPABASE_SERVICE_ROLE_KEY as configured for your Edge Functions>';
alter database postgres set app.settings.supabase_url = '<this project's own API URL>';
```

**Verify** (open a fresh `psql` session after running the above — `ALTER
DATABASE ... SET` only takes effect for new sessions, not the one that ran
it):

```sql
select current_setting('app.settings.service_role_key') = '<paste the same value you just set, to eyeball-compare>';
```

Then confirm end-to-end, not just that the GUC holds *a* value:

```sql
select net.http_post(
  url := current_setting('app.settings.supabase_url') || '/functions/v1/compute-deadlines',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
    'apikey', current_setting('app.settings.service_role_key')
  ),
  body := '{"triggered_by":"manual-verification"}'::jsonb
);
-- then, after a second or two:
select status_code, content from net._http_response order by id desc limit 1;
-- must be 200, not 401
```

A `401` here means the two credentials still don't match — re-check both
values character-for-character (this project's own instance of this bug was
two genuinely different key *formats*, not a typo, so a casual visual
comparison of "does it look like a real key" is not sufficient — compare the
literal strings).

---

## 8. Post-provision manual steps

Everything below **cannot** be performed by a `postgres`-run migration on a
freshly provisioned project, either because it requires `supabase_admin`-
equivalent privilege or because it's inherently a secret/environment-specific
value a migration should never hard-code.

- [ ] **Set the two `app.settings.*` GUCs and verify the cron auth chain
      end-to-end** — see § 7. Do this before relying on any scheduled job.
- [ ] **Set every Edge Function secret** listed in § 5 — `SUPABASE_URL`,
      `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` for every function;
      `VITE_FOOTBALL_DATA_KEY` (and optionally `COMPETITION_ID`) for
      `sync-fixtures` specifically.
- [ ] **Set the frontend's build-time variables** (`VITE_SUPABASE_URL`,
      `VITE_SUPABASE_ANON_KEY`) in whatever mechanism your hosting platform
      uses for build-time env vars — these are inlined at build time by
      Vite, not read at runtime, so a value change requires a rebuild.
- [ ] **Update `supabase/config.toml`'s `[auth]` section for the real
      production domain** before relying on any email-based auth flow
      (password reset, email confirmation, magic link). Confirmed, not
      assumed: this project's own `config.toml` still has `site_url =
      "http://127.0.0.1:3000"` and `additional_redirect_urls =
      ["https://127.0.0.1:3000"]` — the CLI's untouched scaffold default,
      not even matching this project's own actual local dev port (Vite runs
      on `5173`, confirmed throughout live testing). This has gone unnoticed
      because `auth.email.enable_confirmations = false` locally means no
      email-redirect flow is ever actually exercised in dev — it will matter
      immediately in production, where confirmation/reset emails need a
      correct redirect target.
- [ ] **Provision at least one `app_admin`.** Confirmed via grep: there is
      **no** bootstrap script, first-user-is-admin logic, or migration that
      ever sets `app_metadata.role = 'app_admin'` for any user — every
      admin grant on this project's own environment has been done manually,
      via the Supabase Admin API (`auth.admin.updateUserById(id,
      {app_metadata: {role: 'app_admin'}})`) or the Dashboard's user editor.
      Without at least one `app_admin`, nobody can reach `AdminDashboard`'s
      "Manual jobs" section (`ISSUE-9`'s `AdminRoute` guard, plus the
      backend's own `is_app_admin()` check) — pot-level payment/rollover
      management still works for any pot's own creator (pot-admin is
      separate from app-admin), but platform-wide manual triggers do not.
      Run once, for at least one real operator account:
      ```sql
      -- Via the Admin API is preferred (keeps GoTrue's own bookkeeping
      -- consistent); a direct SQL UPDATE also works if the Admin API isn't
      -- reachable, but confirm raw_app_meta_data afterward either way:
      select raw_app_meta_data from auth.users where email = '<the operator's email>';
      -- expect {"role": "app_admin", ...} after granting, not a bare merge
      -- gap — GoTrue's admin API merges app_metadata shallowly, so setting
      -- it to {} does NOT clear a previous value; only an explicit
      -- {"role": null} does (confirmed the hard way during this sprint's
      -- own live testing).
      ```
- [ ] **Check for pre-existing `supabase_admin`-owned objects** before
      trusting a fresh project's RLS/cron state — see
      [deployment-checklist.md](./deployment-checklist.md) for the exact
      queries and remediation, kept there as the detailed historical record
      of exactly this situation on this project's own environment. On a
      genuinely fresh project with nothing created out-of-band before
      migrations ran, this step should find zero rows and can be skipped.
- [ ] **Confirm RLS is enabled with the expected policy shape** on every
      table — `select relname, relrowsecurity, count(p.polname) from
      pg_class c left join pg_policy p on p.polrelid = c.oid where
      relnamespace='public'::regnamespace and relkind='r' group by 1,2;`.
      Every table should show `relrowsecurity = true`; a table showing `0`
      policies is either a deliberate full-lockdown table (this project has
      six, all retired prototype tables no current code reads) or a silent
      full-access-denied bug — cross-reference against `database.md`/this
      project's own current policy count (33 tables, confirmed during this
      sprint) before assuming either.

---

## 9. Deployment sequence

1. Provision the Supabase project (hosted) or run `supabase start` (local).
2. Verify required extensions (§ 2).
3. Apply migrations 001 → 023 in order (§ 3).
4. Complete every item in § 8 (GUCs, secrets, frontend env vars, `config.toml`
   auth URLs, at least one `app_admin`, RLS/ownership check).
5. Deploy every Edge Function listed in § 4.
6. Build and deploy the frontend, pointed at the correct `VITE_SUPABASE_URL`/
   `VITE_SUPABASE_ANON_KEY` for this environment.
7. Run the full smoke-test checklist: [SMOKE-TESTS.md](./SMOKE-TESTS.md).
8. Wait for (or manually trigger, via a signed-in `app_admin`'s "Manual jobs"
   buttons) one real tick of each cron job; confirm `net._http_response`
   shows `200` for each (not just `cron.job_run_details` showing
   `succeeded` — see § 6/§ 7 for why that alone is insufficient).

---

## 10. Rollback considerations

- **Migrations**: this project has no down-migrations / rollback scripts —
  consistent with `CLAUDE.md`'s "never rewrite or delete a historical
  migration" rule. Rolling back a bad migration means writing and applying a
  new, forward-only migration that undoes the specific change, not reverting
  the file.
- **The § 7 GUC fix**: instantly reversible, no data implications —
  `alter database postgres reset app.settings.service_role_key;` (or set it
  back to the previous value) takes effect for new sessions immediately.
- **Edge Function deploys**: redeploying a previous version of a function
  directory is the standard rollback path; no database-side state is tied to
  a specific function version.
- **`app_admin` grants**: reversible via the same Admin API
  (`{"app_metadata": {"role": null}}` — remember the merge-not-replace
  behavior noted in § 8).
- **Frontend**: a static build; rolling back means redeploying the previous
  build artifact. No migration coupling — the frontend and backend are
  deployed independently and the schema has no version-gating logic that
  would break an older frontend build talking to a newer schema, or vice
  versa, within the same major release.

---

## 11. Fixed this sprint (Production Readiness Sprint, 2026-08-10)

- `.env.example` corrected — see [current-state.md](./current-state.md) for
  the full before/after and reasoning. It previously documented
  `FOOTBALL_DATA_KEY`/`FOOTBALL_COMPETITION_CODE`/`FOOTBALL_SEASON`, none of
  which any code reads, and omitted `SUPABASE_ANON_KEY`, which seven Edge
  Functions require.
- This document itself — see the top of this file for what changed and why.

## 12. Known, not fixed this sprint (out of scope — config/data, not code)

- `config.toml`'s `[auth]` `site_url`/`additional_redirect_urls` still point
  at the CLI scaffold default, not even this project's own actual local dev
  port — flagged in § 8 as a required pre-production step, not silently
  corrected here, since the *correct* production value depends on the real
  deployed domain, which this document cannot know in advance.
- `sync-fixtures` has no working API key configured in this local
  environment (§ 5) — requires a real, paid third-party credential this
  session doesn't have access to.
- `deployment-checklist.md`'s own historical execution log is left
  unmodified — it's explicitly a point-in-time record of what was actually
  done for the ISSUE-19/20/21 remediation, not a living document this sprint
  should rewrite.
