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

**Update, 2026-08-18 (Phase 15, Beta Deployment Preparation):** the
database has been cleaned of all demo/disposable-test data ahead of a
planned beta — see `decisions.md` § Phase 15 and `current-state.md`
`ISSUE-58` for what changed.

---

## 0. Beta deployment runbook (Phase 16) — READY vs. BLOCKED

This section is the authoritative "what's actually needed, in order"
checklist for moving from local development to a hosted controlled beta.
It sits above the detailed technical reference (§ 1 onward, mostly
unchanged and still accurate) because most of that reference describes
*how* to do each step once the inputs below exist — this section says
*which steps can happen now* versus *which are blocked on something only
the project owner can supply*.

**Status as of 2026-08-18 (Phase 16 audit): still a 100% local
(`supabase start`) environment.** No hosted Supabase project, no
production domain, no SMTP provider, no hosting platform has been
specified anywhere in this repository — confirmed by inspection, not
assumed (no `vercel.json`/`netlify.toml`/`render.yaml`/`fly.toml`/
`Dockerfile`/CI deploy workflow exists anywhere in the repo; `vite.config.js`
is the framework's own unmodified scaffold with no platform adapter).

### READY IN CODE — verified this phase, needs no further code work

- [x] **Migrations 001–028 replay cleanly.** `supabase migration list
      --local` confirms 001–028 applied with zero gaps. Migration 028
      (new, this phase) closes a real gap: `pot_standings_snapshots`
      (subscribed to by `useLiveScores.js` for live LMS/leaderboard
      updates) was in the local Realtime publication only via
      out-of-band drift, not any migration — a fresh hosted project built
      from migrations alone would have silently never fired those
      updates. Fixed with an idempotent, guarded `ALTER PUBLICATION`
      (see § 3a).
- [x] **Frontend build produces zero secret leakage.** `npm run build`
      then grepped the output `dist/assets/*.js` for
      `SERVICE_ROLE`/`service_role`/`SMTP`/`DB_PASSWORD` — zero matches.
      The only `localhost` strings present are `@supabase/supabase-js`'s
      own internal fallback/cookie-domain-detection code, not this
      project's configuration. Only `VITE_SUPABASE_URL`/
      `VITE_SUPABASE_ANON_KEY` are inlined, as intended — the anon key is
      safe to expose client-side (RLS is the real gate).
- [x] **Demo isolation confirmed safe for a hosted environment.** All
      3 demo Edge Functions (`demo-generate-data`, `demo-gameweek-control`,
      `demo-teardown`) check `app_metadata.role === 'super_admin'`
      server-side — confirmed by reading the source, re-verified live via
      a direct HTTP call with a normal user's token (`403`). Demo data is
      isolated by explicit `league_id`/`demo_sessions.id`, never by name
      matching, and demo leagues are now created `is_active=false`
      (Phase 15, `ISSUE-58`-adjacent fix) so they can never appear
      alongside the real Premier League in Create Competition even while
      a demo session is running.
- [x] **Auth/RLS security model unchanged and re-verified.** Self-
      escalation to `super_admin` structurally impossible
      (`super-admin-actions` never accepts it as a grant target).
      `useIsAdmin()`'s Super Admin gap found and fixed in Phase 15
      (`ISSUE-58`). `requireVerifiedActiveUser()` and every RLS policy
      untouched this phase.
- [x] **Real fixture data refreshed and verified correct.** `ISSUE-59` —
      every fixture in a gameweek was showing an identical kickoff time;
      traced to stale upstream data (not a frontend bug), fixed by
      re-running the existing `fullSyncInsert.js` sync against the live,
      already-configured football-data.org API key. Gameweeks 1–9 now
      show realistic, distinct kickoff times; verified live on both
      Dashboard and the Score Predictor pot page. See § 4's note on the
      `sync-fixtures`/`fullSyncInsert.js` provider mismatch — this fix is
      one-time, not a recurring safeguard, until that gap is resolved.

### MANUAL ACTION REQUIRED FROM YOU — nothing below this line can proceed without it

1. **Hosting platform for the frontend static build.** Not specified
   anywhere in the repo (see status note above). Common candidates —
   **Vercel, Netlify, Cloudflare Pages** — would all work unmodified
   (`npm run build` produces a plain static `dist/`, no platform-specific
   code exists to favor one over another). **I have not created an
   account or deployed anywhere.** Tell me which platform, or if you'd
   like a recommendation with tradeoffs.
2. **A hosted Supabase project.** Create one at
   [supabase.com](https://supabase.com/dashboard) (or tell me if one
   already exists that I haven't been told about). I need from you:
   - The **project URL** (`https://<ref>.supabase.co`) and **anon key**
     (safe to share — it's the public client key) once created.
   - The **service-role key** and **database password**, provided only
     through a secure channel (Supabase secrets / your own password
     manager) — never pasted in chat, never committed.
   - **Region**: recommend the region closest to your expected beta
     users (e.g. `eu-west-2`/London for a UK-focused Premier League
     product) — your call, I don't have a strong reason to override it.
3. **A real SMTP provider.** Local dev uses Mailpit; hosted beta cannot.
   Any transactional-email provider Supabase supports (Resend, Postmark,
   SendGrid, AWS SES, etc.) works — I need:
   SMTP host, port, username, password, sender email, sender name. These
   go into Supabase's own Auth SMTP settings (dashboard or
   `supabase secrets set`), never into frontend code.
4. **A production domain** (or a subdomain, e.g. `beta.yourdomain.com`,
   or the hosting platform's own generated URL if you don't have a
   custom domain yet). Needed to set `site_url`/`additional_redirect_urls`
   correctly — without it, every email verification/password-reset link
   will point at the wrong place.

**Once all four are supplied**, I can execute § 1–§ 9 below in order: run
migrations against the hosted project, deploy Edge Functions, set
secrets, configure `config.toml`'s auth URLs for the real domain,
configure SMTP, provision the Super Admin, deploy the frontend, and run
the full smoke test (`SMOKE-TESTS.md`) before any real beta user is
invited. Nothing in that sequence should require further input from you
beyond confirming each step as it happens, unless something unexpected
turns up.

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

`supabase/migrations/001_initial_schema.sql` through
`028_realtime_standings_snapshot.sql` — **28 migrations**, confirmed
applied in full, in order, with zero gaps, on this project's own local
dev database (`supabase migration list --local` — 001 through 028, local
and remote columns matching throughout, no missing or out-of-order
entries). This is direct evidence migrations replay cleanly, not an
assumption: this local database's entire schema history came from
exactly this sequential apply process (`supabase start`'s own
fresh-provision-and-migrate flow), not a hand-built or manually-patched
database.

### 3a. Migration 028 — Realtime publication gap (Phase 16)

`frontend/src/hooks/useLiveScores.js` subscribes to `postgres_changes` on
`public.pot_standings_snapshots` (live LMS/leaderboard updates), but no
migration before 028 ever added that table to the `supabase_realtime`
publication — `011_realtime_publication.sql` added `fixtures`/
`fixture_events`/`pick5_picks` only. It was present in this project's own
local publication anyway, confirmed via `pg_publication_tables`, but that
was out-of-band drift (added manually at some point, same class of gap
011 itself documents), not something a fresh hosted project built purely
from migrations would have had. Migration 028 adds it, guarded with an
existence check so it replays safely both on a fresh project and on this
project's own database (where it was already present). Applied and
re-verified locally this phase — `pg_publication_tables` now shows all 4
tables on both.

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
function. Current inventory, **15 functions** (re-counted Phase 16 — the
prior "11" undercounted; the 4 missing were `demo-generate-data`,
`demo-gameweek-control`, `demo-teardown`, `super-admin-actions`, present
in the repo the whole time but never previously listed in this table):

| Function | Purpose | Auth model | Classification |
|---|---|---|---|
| `admin-actions` | `mark_paid`/`mark_unpaid`/`record_payment`/`reinstate_entry`/`bulk_verify_payments`/`add_member`/`remove_member` | Signed-in user; per-action pot-admin or app-admin check inside | **PRODUCTION REQUIRED** |
| `compute-deadlines` | Locks entries whose gameweek deadline has passed | Service-role key or signed-in `super_admin` only (`ISSUE-26`, tightened Phase 10B) | **PRODUCTION REQUIRED, CRON** |
| `compute-scores` | Refreshes `player_fixture_goals`, then scores every mode | Service-role key or signed-in `super_admin` only | **PRODUCTION REQUIRED, CRON** |
| `settle-gameweek` | Finalizes a gameweek: settle → standings → winner → prize → notify, per mode | Service-role key or signed-in `super_admin` only | **PRODUCTION REQUIRED, CRON** |
| `sync-fixtures` | Pulls fixtures/teams/players from api-football, upserts | Service-role key or signed-in `super_admin` only | **PRODUCTION REQUIRED, CRON** — see note below on provider mismatch |
| `get-or-create-pick5-entry` | Pick 5 entry creation (idempotent) | Signed-in user | **PRODUCTION REQUIRED** |
| `get-or-create-lms-entry` | LMS entry creation, enforces entry window | Signed-in user | **PRODUCTION REQUIRED** |
| `get-or-create-predictor-entry` | Predictor entry creation | Signed-in user | **PRODUCTION REQUIRED** |
| `submit-pick5-picks` | Pick 5 pick submission | Signed-in user | **PRODUCTION REQUIRED** |
| `submit-lms-pick` | LMS team pick submission | Signed-in user | **PRODUCTION REQUIRED** |
| `submit-predictor-picks` | Predictor scoreline/goalscorer submission | Signed-in user | **PRODUCTION REQUIRED** |
| `super-admin-actions` | Ban/unban, `grant_app_admin`/`revoke_app_admin`, user search, audit log — never accepts `super_admin` as a grant target (self-escalation structurally closed) | Signed-in `super_admin` only | **SUPER ADMIN ONLY** |
| `demo-generate-data` | Creates an isolated demo league/pots/synthetic users (Demo Centre) | Signed-in `super_admin` only | **SUPER ADMIN ONLY** — see § 4a |
| `demo-gameweek-control` | Start/pause/resume/advance the demo gameweek's live-event playback | Signed-in `super_admin` only | **SUPER ADMIN ONLY** — see § 4a |
| `demo-teardown` | Deletes a demo session and everything under it, by explicit ID | Signed-in `super_admin` only | **SUPER ADMIN ONLY** — see § 4a |

`sync-live-events` does **not** exist as a function (`ISSUE-4`, still open,
blocked on a product decision between rebuilding it against api-football or
formalizing an alternative). Its cron job (`sync-live-events-every-2-min`)
will `404` on every tick — expected, not a deployment failure; do not treat
a `404` on this specific job as a broken deployment.

**Provider mismatch, confirmed Phase 16, not yet resolved**: `sync-fixtures`
(the cron-scheduled Edge Function) pulls from **api-football**
(`v3.football.api-sports.io`), but the real Premier League data actually
populating this project (league `6`, 20 teams/38 gameweeks/380 fixtures)
was populated by `frontend/scripts/fullSyncInsert.js`, a **standalone
Node script** pulling from **football-data.org** — a different provider
entirely, run manually, not on any schedule. `sync-fixtures` has never
had a working api-football key in this environment and has never
successfully run. This means **the Edge Function actually wired into
cron is not the one currently keeping real fixture data fresh** — see
`current-state.md` `ISSUE-59` for the concrete kickoff-time staleness
this caused and how it was fixed this phase (by manually re-running the
football-data.org script, not by fixing `sync-fixtures`). **Recommendation
for beta** (not applied this phase — a product/architecture decision, not
a deployment-config one): either wire `fullSyncInsert.js`'s logic into a
proper scheduled Edge Function (mirroring `sync-fixtures`'s cron pattern
but calling football-data.org), or obtain a working api-football key and
switch cron over to the existing `sync-fixtures` function. Either way,
without one of these, real fixture data on the hosted beta will go stale
the same way it did locally, and nobody will be re-running a local Node
script against a hosted database as a matter of routine.

### 4a. Demo Edge Functions — hosted-environment isolation, verified Phase 16

Re-verified specifically for hosted-deployment safety (per this phase's
own explicit "Demo Centre must never operate on real data" requirement):

- All three demo functions check `app_metadata.role !== 'super_admin'` →
  `403`, server-side, before doing anything — confirmed by reading the
  source and by a live HTTP call with a non-super-admin token (`403`).
- `demo-generate-data` creates its own isolated `leagues` row
  (`provider_name='demo'`, `name='Demo Premier League'`, a synthetic
  `year_start`/`year_end` far outside any real season range) and every
  subsequent write (teams/players/gameweeks/fixtures/pots) is scoped to
  that new `league_id` — it never writes into league `6`'s rows.
  `is_active: false` on creation (Phase 15 fix) additionally keeps a
  running demo session from ever appearing in Create Competition or
  Dashboard queries even while active.
- `demo-teardown` deletes by explicit ID chain
  (`demoSessionId`/`leagueId`/`seasonId`/`userIds` from the
  `demo_sessions` row itself), never by name pattern — confirmed by
  reading `_shared/demo/teardown.ts` and by using it for real this phase
  (Phase 15's actual cleanup), independently re-verified against the
  database afterward.
- **No code path in any of the three demo functions references league
  `6`, `fixtures` rows outside the demo league's own gameweeks, or any
  real pot/user by ID.** This was true before this phase and is
  unchanged — confirmed again, not just carried forward from memory.

---

## 5. Secrets and environment variables

**Verified directly against `Deno.env.get(...)` calls in the Edge Function
source and `import.meta.env.VITE_*` calls in the frontend — not copied from
the prior version of this document, which had two genuine errors (below).**

### 5a. Deployment checklist (Phase 16) — values never shown, presence only

| Secret | Purpose | Used by | Required in production | Configured for hosted beta? |
|---|---|---|---|---|
| `SUPABASE_URL` | Server-side project API URL | Every Edge Function | Yes | **No hosted project exists** |
| `SUPABASE_SERVICE_ROLE_KEY` | Full-privilege DB access; also the cron-auth comparison value | Every Edge Function, `_shared/adminOrCronAuth.ts` | Yes | **No hosted project exists** |
| `SUPABASE_ANON_KEY` (server-side) | Resolves the calling user's own identity/claims | `admin-actions`, all `get-or-create-*`/`submit-*` functions, and the human-caller path of the four cron-gated functions | Yes | **No hosted project exists** |
| `VITE_FOOTBALL_DATA_KEY` (server-side, `sync-fixtures` only) | api-football.com key | `sync-fixtures` | Yes, if switching cron to this provider (§ 4's provider-mismatch note) | Present locally but never confirmed working; **not carried over automatically** |
| `COMPETITION_ID` | api-football league ID for `sync-fixtures` | `sync-fixtures`, optional | Only if using `sync-fixtures` | Not set |
| `VITE_SUPABASE_URL` (frontend build-time) | Public API URL | Frontend build | Yes | **No hosted project exists** |
| `VITE_SUPABASE_ANON_KEY` (frontend build-time) | Public anon key | Frontend build | Yes | **No hosted project exists** |
| SMTP host/port/user/password | Transactional auth email | Supabase Auth (dashboard/`supabase secrets set`), not app code | Yes | **No provider supplied** |
| `app.settings.service_role_key` (DB GUC) | Cron job auth header | Every `net.http_post()` cron call | Yes | **No hosted project exists** — and must be re-verified to *match* the Edge Runtime's own key even once set, see § 7 |
| `app.settings.supabase_url` (DB GUC) | Cron job target URL | Same | Yes | **No hosted project exists** |

Nothing above has been guessed or invented. Every "No" is a real, open
item — see § 0's "Manual action required from you" list for exactly what
to supply and how.

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

| Job | Schedule | Calls | Purpose | Auth | Production required? |
|---|---|---|---|---|---|
| `sync-fixtures-daily` | `0 5 * * *` | `sync-fixtures` | Fixture/team/player sync | service-role key, via `app.settings.service_role_key` | **Yes, but see § 4's provider-mismatch note — this job alone will not keep real data fresh as currently wired** |
| `compute-deadlines-hourly` | `0 * * * *` | `compute-deadlines` | Locks entries past deadline | same | Yes |
| `compute-scores-every-3-min` | `*/3 * * * *` | `compute-scores` | Live/final scoring, all modes | same | Yes |
| `settle-gameweek-every-30-min` | `*/30 * * * *` | `settle-gameweek` | Settlement, standings, prizes, notifications | same | Yes |
| `sync-live-events-every-2-min` | `*/2 * * * *` | `sync-live-events` — **expected `404`, function doesn't exist (`ISSUE-4`)** | Would sync live match events | same | No — function doesn't exist; expected 404, not a deployment failure |

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

## 6a. Realtime

`supabase_realtime` publication membership (managed by migration 011,
extended by 028 this phase — see § 3a): `fixtures`, `fixture_events`,
`pick5_picks`, `pot_standings_snapshots`. Consumed by
`frontend/src/hooks/useLiveScores.js` (live fixture scores/events, live
standings). Realtime respects each subscriber's own RLS policies on
`postgres_changes` — this is Supabase's documented default, not a
configuration this project changes, so adding a table to the publication
never bypasses RLS, it only enables the change-stream those policies
already gate. **Action on a hosted project**: none beyond applying
migrations in order — Realtime is enabled by default on every hosted
Supabase project and the publication membership is now fully
migration-tracked (nothing left as manual/out-of-band drift, unlike
before 028).

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
      (password reset, email confirmation, magic link). **Fixed for local
      dev, Phase 8D (2026-08-18)**: `site_url`/`additional_redirect_urls`
      previously still had `127.0.0.1:3000` — the CLI's untouched scaffold
      default, not even matching this project's own local dev port (Vite
      runs on `5173`) — corrected to `http://localhost:5173`. This was
      invisible locally until this session because
      `auth.email.enable_confirmations` was `false`, so no email-redirect
      flow was ever actually exercised; **also flipped to `true` this
      session** (Part 3, email verification is now a real, enforced
      requirement — see [business-rules.md § Identity & email
      verification](./business-rules.md#identity--email-verification)).
      Production still needs its own real domain substituted for
      `localhost:5173` before deploying — this fix only corrected the local
      value, it did not make the setting environment-aware.
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

<a id="super-admin-provisioning"></a>
- [ ] **Provision exactly one Super Admin (Phase 8D).** Distinct from
      `app_admin` above, not a rename of it — Super Admin is the platform
      owner: it inherits every `app_admin` capability (`is_app_admin()`
      accepts either role) plus user search/ban/role-management and
      Demo Centre. There is deliberately **no in-app way to grant or revoke
      `super_admin`** — `super-admin-actions`' `grant_app_admin`/
      `revoke_app_admin` never accept it as a target role, closing the
      self-escalation path structurally, not by convention. The only way to
      create one is this same manual, service-role-only operation
      `app_admin` already uses, run directly by a trusted operator:
      ```sql
      update auth.users
      set raw_app_meta_data = raw_app_meta_data || '{"role": "super_admin"}'::jsonb
      where email = '<the platform owner''s real email>';
      -- confirm: select email, raw_app_meta_data from auth.users where email = '...';
      -- expect {"role": "super_admin", ...} merged in, not replacing
      -- provider/providers.
      ```
      This project's own local Super Admin was provisioned exactly this way
      this session, for the account the user identified as the platform
      owner — see
      [session-log.md](./session-log.md) for that session's record. Without
      any Super Admin provisioned, `/super-admin/*` and the tightened
      `/admin/demo*` routes are unreachable by anyone, including existing
      `app_admin` accounts — this is the intended, fail-closed default, not
      a bug to work around.
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
3. Apply migrations 001 → 028 in order (§ 3) — includes 028's Realtime
   publication fix (§ 3a); confirm afterward via `select tablename from
   pg_publication_tables where pubname='supabase_realtime'` — expect
   `fixtures`, `fixture_events`, `pick5_picks`, `pot_standings_snapshots`.
4. Complete every item in § 8 (GUCs, secrets, frontend env vars, `config.toml`
   auth URLs, SMTP, at least one Super Admin, RLS/ownership check).
5. **Load real Premier League reference data** — run
   `frontend/scripts/fullSyncInsert.js` (with `FOOTBALL_COMPETITION_CODE=PL`,
   `FOOTBALL_SEASON=2026`, and `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
   pointed at the hosted project) rather than copying local rows —
   generated IDs will differ per project, and this produces real,
   current, provider-sourced data. Verify the resulting league is
   `is_active=true` and no other league is. See `current-state.md`
   `ISSUE-59` for why this specific script (not `sync-fixtures`, not a
   manual copy) is the right tool. **Do not carry over any demo-tagged
   row from local** — confirmed none exist locally as of Phase 15, but
   re-verify with `select count(*) from leagues where provider_name='demo'`
   before going live regardless.
6. Deploy every Edge Function listed in § 4.
7. Build and deploy the frontend, pointed at the correct `VITE_SUPABASE_URL`/
   `VITE_SUPABASE_ANON_KEY` for this environment.
8. Run the full smoke-test checklist: [SMOKE-TESTS.md](./SMOKE-TESTS.md).
9. Wait for (or manually trigger, via a signed-in Super Admin's "Manual jobs"
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
