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

**Update, 2026-08-19 (Phase 20, Beta Readiness / Production Hardening
Audit) — supersedes the Phase 16 status below as the current picture.**
Full audit in `decisions.md` § Phase 20; issue-level detail in
`current-state.md`. Bottom line: **CODE CHANGES REQUIRED items are now
resolved or explicitly flagged as PRODUCT DECISION REQUIRED. Nothing
below is BLOCKED by code — everything remaining is external
configuration only supplied by the project owner.**

**Update, 2026-08-19 (Phase 21, Beta Architecture Decisions +
Deployment Preparation) — supersedes Phase 20's "PRODUCT DECISION
REQUIRED" list below; all three items resolved.** Full detail in
`decisions.md` § Phase 21. **Fixture ingestion is now CODE READY**:
`sync-fixtures` was rewritten to call football-data.org (the provider
that has always actually populated real data), fixing a previously-
undiscovered season-resolution bug in the same change — live-verified
against the real API and database. **Season rollover and `ISSUE-39`
are now documented decisions**, not open questions — manual rollover
(exact procedure in `decisions.md`), `is_current` intentionally
unused. See § 0 and § 4 below for the updated picture.

**Update, 2026-08-19 (Phase 22, Production Live-Match Event Pipeline)
— closes the single biggest remaining gap: live in-match data.** Full
detail in `decisions.md` § Phase 22. Found and fixed a critical,
previously-undiscovered gap — **nothing updated live scores at all**
(neither provider wrote `fixtures.status`/`home_goals`/`away_goals`
during a match) — via a new `sync-live-scores` Edge Function. Found and
fixed the single most severe bug of any phase so far: `ws-live-events.js`
wrote `fixture_events.event_type` in the wrong case, which would have
silently scored **zero Pick 5 goals ever**, with no error anywhere.
Formalized two pieces of out-of-band schema drift (a missing unique
constraint the worker already depended on; the entire
`whoscored_fixture_id`/stats-column set) into new migrations — a fresh
hosted project would previously have been missing them entirely.
Hardened the worker (retry, graceful shutdown, health endpoint,
configurable headless mode). Recommends **Railway** for hosting the
persistent worker (Fly.io alternative, VPS fallback) — see § 6d.
**The live-match system is now code-complete but still requires a
persistent worker host to actually run** — see § 6d and § 15 for
exactly what remains.

---

## 0. Beta deployment runbook — READY vs. BLOCKED vs. PRODUCT DECISION

This section is the authoritative "what's actually needed, in order"
checklist for moving from local development to a hosted controlled beta.
It sits above the detailed technical reference (§ 1 onward) because that
reference describes *how* to do each step once the inputs below exist —
this section says *which steps can happen now* versus *which are
blocked on something only the project owner can supply or decide*.

**Status as of 2026-08-19: still a 100% local (`supabase start`)
environment.** No hosted Supabase project, no production domain, no
SMTP provider, no hosting platform has been specified anywhere in this
repository — re-confirmed by inspection this phase, not assumed (no
`vercel.json`/`netlify.toml`/`render.yaml`/`fly.toml`/`Dockerfile`/CI
deploy workflow exists anywhere in the repo; `vite.config.js` is the
framework's own unmodified scaffold with no platform adapter).

### CODE READY — verified, needs no further code work

- [x] **Migrations 001–030 replay cleanly** (§ 3). Includes the Realtime
      publication fix (028) and the pick-lock deadline consolidation
      (029/030, § 3b) — both formerly out-of-band drift, now fully
      migration-tracked.
- [x] **One authoritative pick-lock rule**: 15 minutes before the
      earliest confirmed fixture kickoff, one DB trigger, `compute-deadlines`
      only reads it. Re-verified Phase 20 (§ 3b) — still holds.
- [x] **Frontend build produces zero secret leakage** — re-confirmed
      Phase 20: `dist/assets/*.js` grepped for
      `SERVICE_ROLE`/`service_role`/`SMTP`/`DB_PASSWORD`, zero matches.
- [x] **Demo isolation** — re-confirmed Phase 20 with a fresh live HTTP
      matrix: `demo-teardown`/`super-admin-actions` both `403` for a
      normal user AND an `app_admin` token, `200` only for the real
      `super_admin` (positive control, not just "everyone rejected").
      Zero active demo leagues, zero demo users, zero demo sessions in
      the current database.
- [x] **Auth/RLS security boundaries** — re-verified live Phase 20 (not
      just re-cited): `compute-deadlines` (Manual Jobs) and
      `super-admin-actions` both correctly `401`/`403` a normal user and
      an `app_admin`, both correctly `200` for `super_admin`. Self-
      escalation still structurally closed.
- [x] **Real fixture data, kickoff times, and unconfirmed-time handling**
      all correct (`ISSUE-59`, `ISSUE-62`) — confirmed gameweeks with
      confirmed broadcast times show real, distinct kickoffs; gameweeks
      without them show "Time TBC," never a fabricated `00:00`.
- [x] **Top-level error boundary added** (Phase 20, new) — this app had
      none; an uncaught render error would have unmounted the entire
      React tree to a blank white page. `frontend/src/components/ErrorBoundary.jsx`,
      wrapping `<App/>` in `main.jsx`, matching the existing
      `NotAuthorized.jsx`/`NotFound.jsx` styled-fallback pattern. Not a
      monitoring platform — a local `console.error` plus a real "Reload
      page" recovery action.
- [x] **Payment model is manual-only, and that's the intended design, not
      a gap** — confirmed via `business-rules.md § Payment verification
      rules`: no Stripe/PayPal/gateway integration anywhere in the
      codebase (confirmed by grep). `entry_payments.is_paid` is an
      admin-set record of money received off-platform. Beta-safe as-is —
      no code change needed, no false "payment processed" implication
      anywhere in the UI (checked: "Paid"/"Unpaid" badges only).
- [x] **Fixture ingestion now has one authoritative, cron-scheduled
      path** (Phase 21, `ISSUE-64`) — `sync-fixtures` calls
      football-data.org (the provider that has always actually
      populated real data), fixing a previously-undiscovered
      season-resolution bug in the same rewrite. Live-verified end to
      end against the real API and database. See § 4 and
      `decisions.md § Phase 21` for the full SOURCE → TABLE →
      FREQUENCY → PURPOSE breakdown and the production cron matrix
      (§ 6c, new).
- [x] **No secret reaches the client bundle** — re-confirmed Phase 21:
      the one file that read a `VITE_`-prefixed football-data.org key
      client-side (`lib/footballDataProvider.js`, already-dead code)
      was deleted outright, and the built bundle was re-grepped clean
      afterward. `.env.example` rewritten into an explicit PUBLIC
      FRONTEND / SERVER-SECRET split.
- [x] **Live score/status now has a real, working writer** (Phase 22,
      `ISSUE-68`) — previously nothing updated `fixtures.status`/
      `home_goals`/`away_goals` during a match at all. New
      `sync-live-scores` Edge Function, football-data.org-sourced, live-
      verified end to end. See § 6c/§ 6d.
- [x] **The single most severe bug found in any phase so far, fixed**
      (Phase 22, `ISSUE-69`) — `ws-live-events.js` wrote
      `fixture_events.event_type` in the wrong case, which would have
      silently produced zero Pick 5 goals ever, forever, with no error.
      Fixed; every other consumer already used the correct casing.
- [x] **Two pieces of out-of-band schema drift formalized into
      migrations** (Phase 22, `ISSUE-70`/`ISSUE-71`) — the real
      `fixture_events` unique constraint the worker's upsert already
      depended on, and the entire `whoscored_fixture_id`/
      `whoscoredteamid`/`whoscoredplayerid`/`stats_*` column set the
      WhoScored pipeline needs, both existed only on this project's own
      local database, never in any migration. A fresh hosted project
      would have been missing them entirely. Fixed via migrations
      031/032, applied and re-verified locally.
- [x] **Live-event worker hardened for production** (Phase 22,
      `ISSUE-72`) — retry-with-backoff, per-cycle error isolation (a
      bad cycle no longer kills the whole process), real graceful
      shutdown, a new `/health` endpoint, configurable headless mode.
      See § 6d for what still needs a human decision (which host) and
      manual action (actually deploying it there).

### DECIDED, DOCUMENTED — not a beta blocker, no code needed

1. **Season/gameweek lifecycle beyond one season**: manual rollover,
   by design (Phase 21) — the schema already isolates seasons cleanly
   (per-season unique constraints, pots never re-point across
   seasons), so rollover is a documented data operation, not a code
   gap. Exact step-by-step procedure:
   `decisions.md § Phase 21 — Season rollover`. Nothing to build before
   beta; revisit only when the second season actually approaches.
2. **`ISSUE-39`** (`is_current` never `true` on any gameweek) — Phase
   21 formally investigated and decided **intentionally unused**:
   every real consumer already has working fallback logic
   (`useNextGameweek()`, fallback chains) that doesn't depend on it,
   and building a maintenance mechanism would add a second, competing
   "what's current" source for no correctness benefit. Full reasoning:
   `decisions.md § Phase 21 — is_current`.

### MANUAL ACTION REQUIRED FROM YOU — nothing below this line can proceed without it

1. **Hosting platform for the frontend static build.** Not specified
   anywhere in the repo. Recommendation (§ 2 below, unchanged from
   Phase 16, re-assessed Phase 20 and still the right call): **Vercel**.
   Netlify and Cloudflare Pages would also work unmodified — no
   platform-specific code exists to favor one over another; the choice
   barely matters technically for this project's architecture. **I have
   not created an account or deployed anywhere.**
2. **A hosted Supabase project.** I need the project URL, anon key
   (safe to share), service-role key and DB password (secure channel
   only, never in chat), and your preferred region.
3. **A real SMTP provider** (§ 11) — host, port, username, password,
   sender email/name. Goes into Supabase's own Auth SMTP settings, never
   into frontend code.
4. **A production domain** (or subdomain, or the hosting platform's own
   generated URL) — needed for `site_url`/`additional_redirect_urls`
   (§ 7).
5. **A real football-data.org API key** for `FOOTBALL_DATA_KEY` (§ 5) —
   required for the now-fixed `sync-fixtures` cron job to keep fixture
   data fresh on the hosted project; the key used for this phase's
   local live verification does not automatically carry over to a
   hosted deployment.
6. **Where to actually host the persistent WhoScored live-events
   worker** (§ 6d, new Phase 22) — recommendation made (**Railway**,
   Fly.io alternative, VPS fallback), nothing created or deployed. It
   needs a persistent, always-on Node.js/Playwright host outside the
   Vercel+Supabase serverless stack — this is the one piece of this
   phase's work that genuinely cannot proceed further without you
   picking a host and creating an account there. **Narrower than it
   was before this phase**: live *scores*/*status* now work without
   this worker at all (`sync-live-scores`, Phase 22, is a normal Edge
   Function + cron, no separate host needed) — only live in-match
   *events* (goals/cards/subs) and goalscorer detail depend on this
   worker actually running somewhere.

**Once these are supplied**, § 1–§ 9 below can execute in order: run
migrations against the hosted project, deploy Edge Functions, set
secrets, configure `config.toml`'s auth URLs, configure SMTP, provision
the Super Admin, deploy the frontend, and run the full smoke test
(`SMOKE-TESTS.md`) before any real beta user is invited.

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
`030_deadline_excludes_unconfirmed_kickoffs.sql` — **30 migrations**,
confirmed applied in full, in order, with zero gaps, on this project's
own local dev database (`supabase migration list --local` — 001 through
030, local and remote columns matching throughout, no missing or
out-of-order entries; re-confirmed again Phase 20, still true). This is direct evidence migrations replay cleanly, not an
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

### 3b. Migrations 029/030 — the pick-lock deadline, one authoritative rule (Phase 19)

**The rule**: picks lock 15 minutes before the earliest non-postponed,
non-cancelled, non-unconfirmed (`'tbd'`) fixture kickoff in a gameweek —
see [business-rules.md § When picks lock](./business-rules.md#when-picks-lock)
for the full plain-language rule and its history (this project
previously had *four* independent, disagreeing implementations of this
one rule — `ISSUE-24`, `ISSUE-61`, resolved). **The single authoritative
implementation**: the SQL function `refresh_gameweek_deadlines()`,
invoked by an `AFTER INSERT OR UPDATE OR DELETE` statement-level trigger
on `fixtures` (`trg_refresh_gameweek_deadlines_on_fixtures`) — both now
created by `029_deadline_single_source_of_truth.sql` (offset, one
writer) and `030_deadline_excludes_unconfirmed_kickoffs.sql` (excludes
`'tbd'` fixtures too, so an all-unconfirmed gameweek gets `null`, never
a fabricated deadline). `compute-deadlines` (§ 4) no longer computes or
writes `gameweeks.deadline_utc`/`earliest_kickoff_utc` — it only reads
what this trigger already maintains.

**Re-verified Phase 20, still holds**: `earliest_kickoff_utc -
deadline_utc = exactly 15 minutes` for every gameweek with at least one
confirmed fixture; `null`/`null` for gameweeks where no fixture's
kickoff is confirmed yet (`gameweeks.deadline_utc is null` — the
frontend shows "Time TBC", never a countdown, for exactly this case —
see `ISSUE-62`).

**Both objects were `supabase_admin`-owned before these migrations,
not `postgres`-owned** (the same ownership split `ISSUE-21` documents
for other objects) — applying migrations 029/030 to a hosted project
requires running as `supabase_admin` or an equivalent superuser role,
same as § 7's GUC fix below, not the default migration-runner role. On
a genuinely fresh hosted project (nothing created out-of-band before
migrations run) this is a non-issue — `CREATE FUNCTION`/`CREATE
TRIGGER` succeed under the standard migration role when nothing with
the same name already exists under a different owner.

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
function. Current inventory, **16 functions** (Phase 22 adds
`sync-live-scores` — previously "15 functions," re-counted Phase 16):

| Function | Purpose | Auth model | Classification |
|---|---|---|---|
| `admin-actions` | `mark_paid`/`mark_unpaid`/`record_payment`/`reinstate_entry`/`bulk_verify_payments`/`add_member`/`remove_member` | Signed-in user; per-action pot-admin or app-admin check inside | **PRODUCTION REQUIRED** |
| `compute-deadlines` | Reads `gameweeks.deadline_utc` (maintained by the DB trigger — see § 3b) and locks entries whose deadline has passed. As of Phase 19, no longer computes or writes the deadline itself. | Service-role key or signed-in `super_admin` only (`ISSUE-26`, tightened Phase 10B) | **PRODUCTION REQUIRED, CRON** |
| `compute-scores` | Refreshes `player_fixture_goals`, then scores every mode | Service-role key or signed-in `super_admin` only | **PRODUCTION REQUIRED, CRON** |
| `settle-gameweek` | Finalizes a gameweek: settle → standings → winner → prize → notify, per mode | Service-role key or signed-in `super_admin` only | **PRODUCTION REQUIRED, CRON** |
| `sync-fixtures` | Pulls fixtures/teams/gameweeks from football-data.org, upserts (Phase 21 rewrite — `ISSUE-64`) | Service-role key or signed-in `super_admin` only | **PRODUCTION REQUIRED, CRON** — live-verified working, see § 6c for the full cron matrix |
| `sync-live-scores` | **New, Phase 22 (`ISSUE-68`)**. Updates `fixtures.status`/`home_goals`/`away_goals`/`minute` from football-data.org during a live match — the field `sync-fixtures`' once-daily cadence is too slow for. Free/no-op unless a fixture is actually in its live window. | Service-role key or signed-in `super_admin` only | **PRODUCTION REQUIRED, CRON** — live-verified working, see § 6c |
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

**Provider mismatch — resolved Phase 21 (`ISSUE-64`).** `sync-fixtures`
now pulls from **football-data.org**, the provider that has always
actually populated this project's real data (league `6`, 20 teams/38
gameweeks/380 fixtures) — porting `frontend/scripts/fullSyncInsert.js`'s
proven logic directly into the cron-scheduled Edge Function, rather than
leaving a second, disagreeing implementation in place. The rewrite also
fixed a previously-undiscovered structural bug: the old function
resolved "the" season via `seasons.is_current`, which points at an
empty season on this project's real data — even a working api-football
key would have synced real fixtures into the wrong season. Live-verified
end to end this phase: a real HTTP call against the real football-data.org
API and real database returned `{"success":true,"processed":438,...}`
(exact match — 20 teams + 38 gameweeks + 380 fixtures), with no
duplicate season/league created and Phase 19's deadline trigger firing
correctly on the new writes. `fullSyncInsert.js` itself is unchanged and
still works the same way — it's now the documented manual tool for
season rollover (`decisions.md § Phase 21 — Season rollover`), not a
competing production path. See `decisions.md § Phase 21` for the full
provider comparison and the SOURCE → TABLE → FREQUENCY → PURPOSE table,
and § 6c below for the production cron schedule.

**What this does not cover**: fixture-level goal/card/substitution
events and goalscorers. Neither football-data.org's nor api-football's
implementation in this codebase provides those — that gap is covered by
a third, separate mechanism (WhoScored via Playwright browser
automation, `frontend/scripts/ws-live-events.js` and its mapping
scripts), which requires a persistent Node.js host and cannot run as an
Edge Function or via `pg_cron` alone — see § 6c and § 0's "Manual action
required" list.

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
| `FOOTBALL_DATA_KEY` (server-side, `sync-fixtures` + `fullSyncInsert.js`/`fullSyncPlayers.js`) | football-data.org (`api.football-data.org/v4`) key | `sync-fixtures` | Yes | Confirmed working — live-verified this phase against the real API. **Still needs setting on the hosted project** — the key used for local verification does not carry over automatically |
| `FOOTBALL_COMPETITION_CODE` | football-data.org competition code (e.g. `PL`) | `sync-fixtures`, optional, defaults to `'PL'` | No | Not set — default is correct for this project |
| `FOOTBALL_SEASON` | football-data.org season start year | `sync-fixtures`, optional, defaults to current year | No | Not set — default is correct once the real season starts |
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
| `FOOTBALL_DATA_KEY` | `sync-fixtures` only (Phase 21 rewrite, `ISSUE-64`) | The football-data.org (`api.football-data.org/v4`) API key, sent as the `X-Auth-Token` header. Also accepts `VITE_FOOTBALL_DATA_KEY` as a fallback name for backward compatibility with `frontend/.env.local`'s existing value — set `FOOTBALL_DATA_KEY` going forward. Live-verified working this phase. |
| `FOOTBALL_COMPETITION_CODE` | `sync-fixtures` only, optional | football-data.org competition code, e.g. `PL` = Premier League. Defaults to `'PL'`; can also be overridden per-request via the function's JSON body (`{"competitionCode": "..."}`). |
| `FOOTBALL_SEASON` | `sync-fixtures` only, optional | football-data.org season start year, e.g. `2026`. Defaults to the current calendar year; can also be overridden per-request (`{"seasonYear": ...}`). |

**Local verification performed this phase (Phase 21)**: a real
`supabase/functions/.env` was created locally (gitignored, confirmed via
`git check-ignore -v`) containing a real `FOOTBALL_DATA_KEY`, and the
rewritten `sync-fixtures` was live-tested against it via a temporary
`supabase functions serve --env-file supabase/functions/.env
--no-verify-jwt` process — confirmed working end to end
(`{"success":true,"processed":438,...}`). **This key does not
automatically carry over to a hosted deployment** — a fresh production
project must still have `FOOTBALL_DATA_KEY` set via `supabase secrets set`
for `sync-fixtures`/the daily cron job to work.

### Frontend build-time variables (`frontend/.env.local` for local dev; the
equivalent mechanism for your hosting platform — e.g. build-time environment
variables — for a real deployment, since Vite inlines these at build time,
not runtime)

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | The project's public API URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | The public anon key — safe to expose client-side, RLS is the real gate |

**Phase 21 update**: `VITE_FOOTBALL_DATA_KEY` is no longer a frontend
variable at all — `lib/footballDataProvider.js`, the only file that
ever read it client-side, was **deleted** (`ISSUE-11`), since a
`VITE_`-prefixed football-data.org key is a live client-bundle
secret-exposure risk the moment anything imports it, not just dead
code. Do not add a `VITE_`-prefixed football-data.org (or any other
third-party API) key to the frontend build — it belongs only in the
server/Edge Function secrets table above, under the plain
`FOOTBALL_DATA_KEY` name.

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
| `sync-fixtures-daily` | `0 5 * * *` | `sync-fixtures` | Fixture/team/gameweek sync (football-data.org, Phase 21 rewrite) | service-role key, via `app.settings.service_role_key` | Yes — live-verified working; see § 6c for the full schedule rationale |
| `compute-deadlines-hourly` | `0 * * * *` | `compute-deadlines` | Locks entries past deadline | same | Yes |
| `compute-scores-every-3-min` | `*/3 * * * *` | `compute-scores` | Live/final scoring, all modes | same | Yes |
| `settle-gameweek-every-30-min` | `*/30 * * * *` | `settle-gameweek` | Settlement, standings, prizes, notifications | same | Yes |
| `sync-live-scores-every-minute` | `* * * * *` | `sync-live-scores` (Phase 22, `ISSUE-68`) | Live `fixtures.status`/`home_goals`/`away_goals`/`minute` during a match | same | Yes — runs every minute continuously but is a free, local-only no-op unless a fixture is actually in its live window; see § 6c |
| `sync-live-events-every-2-min` | `*/2 * * * *` | `sync-live-events` — **expected `404`, function doesn't exist (`ISSUE-4`)** | Formally superseded, Phase 22 — see `current-state.md` `ISSUE-4` | same | No — function doesn't exist and never should; expected 404, not a deployment failure. The real replacement is the persistent worker, § 6d |

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

## 6b. SPA routing / hosted rewrite configuration (Phase 20)

React Router (`BrowserRouter`, confirmed in `main.jsx`) handles routing
entirely client-side — every route (`/dashboard`, `/pots`, `/profile`,
`/admin`, `/super-admin`, `/pot/:potId`, `/pot/:potId/manage`,
`/join/:inviteCode`, etc.) exists only in the JS bundle, not as a real
file on the server. **A direct load or refresh of any non-root URL will
`404` on a static host unless it's configured to serve `index.html` for
every path and let the client-side router take over.** This is a
generic SPA requirement, not specific to this project's route list, and
applies identically to every route above.

**Deliberately not configured yet** — per this phase's own instruction
not to add hosting config before a provider is chosen, since the exact
mechanism differs per platform:

- **Vercel**: zero-config for a Vite SPA — its framework preset detects
  Vite and serves `index.html` as the SPA fallback automatically. No
  file needed.
- **Netlify**: requires a `public/_redirects` file containing
  `/* /index.html 200`, or the equivalent in `netlify.toml`.
- **Cloudflare Pages**: same `_redirects` file format as Netlify, placed
  in the build output directory.

Whichever platform is chosen, this is a one-line config file (or zero
config, for Vercel) — not a code change to the app itself, and not
something to add speculatively for a platform that isn't the one
actually used.

---

## 6c. Production fixture-sync schedule (Phase 21)

Based on real provider/API constraints observed this phase, not
invented frequencies. `sync-fixtures-daily` (§ 6) is already correctly
scheduled for football-data.org's own rate limits — this section
documents *why* each frequency is what it is, and what's still missing
for live in-match data.

| Function | Source | Purpose | Frequency | Time / window | Required secret | Failure impact |
|---|---|---|---|---|---|---|
| `sync-fixtures` (cron: `sync-fixtures-daily`) | football-data.org `/v4/competitions/{code}/{teams,matches}` | Fixtures, teams, gameweeks, kickoff times, status (scheduled/tbd/live/finished/postponed/cancelled), final scores | Once daily | `0 5 * * *` (05:00 UTC — outside any real Premier League kickoff window, so a mid-sync read never races a live match update) | `FOOTBALL_DATA_KEY` | A missed tick is not urgent — fixture data changes slowly day to day (schedule confirmations, postponements); the next day's tick self-corrects. A confirmed kickoff time that changes intraday (rare) would lag up to 24h until the next tick — acceptable for beta, revisit if a real postponement needs same-day visibility |
| `sync-live-scores` (cron: `sync-live-scores-every-minute`, **Phase 22**, `ISSUE-68`) | football-data.org `/v4/competitions/{code}/matches?dateFrom&dateTo=today`, same provider as `sync-fixtures` | `fixtures.status`/`home_goals`/`away_goals`/`minute` **during** a match — the field `sync-fixtures`' daily cadence cannot serve. Also performs same-call reconciliation (a finished match's final score is in the same response) | Every minute, continuously | Free/local-only DB check every tick; only calls the external API when a fixture is within -10min/+130min of kickoff and not yet finished | `FOOTBALL_DATA_KEY` (same secret as `sync-fixtures`) | A missed tick delays the live score/status update by another minute — self-corrects on the next tick, no manual intervention. Before Phase 22, **there was no writer of these fields at all during a match** — this is a newly-closed gap, not a frequency tuned from an existing baseline |
| `frontend/scripts/fullSyncInsert.js` (manual, standalone) | football-data.org, identical logic to `sync-fixtures` | Season rollover (new season's teams/gameweeks/fixtures) or ad hoc backfill | Manual only — once per season, or on demand | N/A | `FOOTBALL_DATA_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (as script env vars) | None — not part of the automated pipeline. See `decisions.md § Phase 21 — Season rollover` for the exact manual procedure this script is step 1 of |
| `frontend/scripts/fullSyncPlayers.js` (manual, standalone) | football-data.org `/v4/teams/{id}` (squads) | Player/squad reference data | Manual — after fixtures exist for a season, or when squads change | N/A, rate-limited to ~6.5s between requests (free-tier constraint, ~2+ min for 20 teams) | Same as above | None — not part of the automated pipeline. **Has a known, separate bug** (`ISSUE-65`, stale hardcoded `SEASON_ID`) that must be checked before running against a new season |
| WhoScored live-events pipeline (`ws-live-events.js` + 3 mapping scripts, **hardened Phase 22**, `ISSUE-72`) | WhoScored.com (Playwright browser automation, not an official API) | Live in-match goal/card/substitution events and goalscorers — the one thing neither football-data.org nor api-football's implementation in this codebase covers | Polls every 60s while actively running; only fixtures within -10min/+130min of kickoff (same window as `sync-live-scores`); mapping scripts run once per season / as squads change | During live matches only | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (script env vars, never an Edge Function secret — see § 6d) | **Not yet deployed anywhere persistent** — see § 6d for the hosting recommendation and exactly what remains manual. Without this running somewhere, the app now has correct fixtures/kickoffs/live scores/final results (Phase 22's `sync-live-scores` fix) but no live in-play events or goalscorers during a match |

**Why daily, not hourly or more frequent, for `sync-fixtures`**:
football-data.org's free tier is the binding constraint (the same
tier `fullSyncPlayers.js`'s ~6.5s inter-request delay exists to
respect) — fixture schedule data doesn't change intraday under normal
circumstances, so a daily sync is the correct match for how often the
underlying data actually changes, not an arbitrary choice. **Phase 21's
version of this document assumed `compute-scores` or the daily sync
already kept live status/scores fresh within a match day — that
assumption was wrong, and Phase 22 found and fixed the actual gap**
(`sync-live-scores`, above) — corrected here rather than left standing.

---

## 6d. Persistent live-event worker — hosting, deployment plan, health, secrets (Phase 22)

`ws-live-events.js` needs a real, always-on Node.js process with a
Chromium browser (via Playwright) that Deno's Edge Runtime cannot
provide and `pg_cron` cannot invoke (not an HTTP API). This is a
genuinely separate piece of infrastructure from Vercel (frontend) and
Supabase (backend) — nothing in this section has been created or
deployed; it is a plan, not an action taken.

### Hosting recommendation: Railway (primary)

**Railway**, Fly.io as the strongest alternative, a self-managed VPS as
a cost-minimizing fallback if comfortable with manual ops. Not Render
as the primary pick — its Background Worker service type is fully
viable, but doesn't get a free tier the way Railway's low-usage tier
effectively does, and Railway's deploy story (closest to this
project's own "git push, near-zero config" Vercel choice) is simpler
for this specific workload. Full comparison table and reasoning:
`decisions.md § Phase 22 — Production worker hosting recommendation`.
**No account created on any of these — this is a recommendation, not
an action.**

### What the worker needs, wherever it runs

- **A persistent process**, not a serverless/on-demand function — the
  script runs an infinite loop with its own internal 60s poll timer,
  not something that starts fresh per-request.
- **Chromium via Playwright**, and — since this phase deliberately kept
  `headless:false` as the default (see `decisions.md` for why switching
  wasn't safe to assume) — **a virtual display**. Standard, well-known
  pattern, not project-specific: `apt-get install -y xvfb` in the
  worker's Dockerfile, start command `xvfb-run -a node
  scripts/ws-live-events.js` instead of a bare `node` invocation. Set
  `WS_HEADLESS=true` only with specific evidence that headless Chromium
  doesn't increase Cloudflare blocking for this deployment — not by
  default.
- **The persistent Chrome profile directory** (`.chrome-profile/`,
  currently local-only, git-ignored) should be copied to the worker
  host once (out of band, not via git — it may contain session
  cookies) so the worker starts with the same carried-forward session
  state that's made WhoScored access work reliably in this phase's own
  tests, rather than starting from a cold profile.

### Build/start commands (no Dockerfile created this phase — this is what it would contain)

```
# Dockerfile (not created — documented only)
FROM mcr.microsoft.com/playwright:v1.61.0-jammy
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --omit=dev
COPY frontend/scripts ./scripts
COPY frontend/.chrome-profile ./.chrome-profile   # copied out of band, not committed
CMD ["xvfb-run", "-a", "node", "scripts/ws-live-events.js"]
```

`frontend/package.json` has no `engines` field — worth pinning (e.g.
`"engines": {"node": ">=20"}`) once an actual host is chosen, so a
platform's auto-detected Node version doesn't silently drift; not
changed this phase since it has no effect locally and the real target
version depends on the chosen host's available base images.

### Environment variables / secrets (worker-only — never frontend, never committed)

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | Yes | Same value as the Edge Functions' own `SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Full-privilege — **must never reach the frontend bundle or be committed**. Set only via the worker host's own secrets mechanism (Railway/Fly/Render all have one; a VPS uses a root-only-readable `.env` file, matching this project's own established local pattern for `supabase/functions/.env`) |
| `WS_HEADLESS` | No, defaults `false` | Only set `true` with specific evidence it's safe for that deployment — see above |
| `WS_HEALTH_PORT` | No, defaults `8787` | Health check port — point the host's health-check config at `GET /health` on this port |

No football-data.org key is needed by this worker — it only ever talks
to WhoScored and Supabase, never football-data.org (that's
`sync-live-scores`/`sync-fixtures`'s job, and they're already Edge
Functions with their own, separate secret).

### Health check / restart policy

- **Health check**: `GET http://<worker-host>:8787/health` — returns
  `{"status": "ok"|"degraded", "uptimeSeconds", "browserAlive",
  "activeFixtureCount", "lastPollAt", "lastSuccessfulScrapeAt",
  "lastDbWriteAt", "lastError", "pollCount"}`. Point Railway's/Fly's/
  Render's own built-in HTTP health-check config at this path; a VPS
  needs a small external check (a cron-based `curl` + alert, or a free
  uptime-monitoring service hitting the same URL) since there's no
  platform to do it automatically.
- **Restart policy**: rely on the host's own automatic-restart-on-crash
  (Railway/Render/Fly.io all do this natively; a VPS needs a `systemd`
  unit with `Restart=always`, or `pm2`). Deliberately not built
  in-process (no self-respawning browser logic) — matches this phase's
  own "keep it simple, don't over-engineer" instruction; a process-level
  restart is simple, well-understood, and sufficient at this scale.

### Beta acceptance test (Phase 22, § 20 of the brief)

A concrete, steppable proof a beta launch actually works, covering
sign-up through settlement. Steps 1-7 and 14-20 were already exercised
in earlier phases (auth, pot creation/join, pick submission, deadline
lock) and are not re-verified in full here — this phase's own live
testing focused on steps 7-13 (the live-match steps this phase's work
targets), since no real Premier League match exists to test against
yet (season starts 2026-08-21).

| # | Step | Verified this phase? | Evidence |
|---|---|---|---|
| 1-6 | Sign up → verify email → sign in → create/join pot → make a pick | Previously verified (Phase 21's UX pass) | Not re-run this phase — no relevant code changed |
| 7 | Fixture locks exactly 15 min before kickoff | Previously verified (Phase 19) | Unchanged this phase |
| 8 | Live score appears | **Yes, code path verified** | `sync-live-scores` live-tested via reversible fixture-window perturbation — real API call, real (correct, zero) update, real skip-path confirmation. **Not verified against an actual live match** — none exists yet |
| 9 | Goal appears | **Partially — extraction mechanism proven, not an actual goal** | Real `/Matches/{id}/Live` page loaded, `matchCentreData` confirmed present for a real, correctly-mapped fixture. No real goal has occurred to scrape (pre-season) |
| 10 | Goalscorer appears | Same as #9 | `player_id` resolution logic reviewed and unchanged from before this phase (already correct); not exercised against a real goal |
| 11 | Assist appears if supplied | Same as #9 | Confirmed already correctly modeled as `assist_player_id` on the goal row — not a bug, not exercised live |
| 12 | Cards/substitutions appear | Same as #9 | Same extraction mechanism as goals; not exercised against a real card/sub |
| 13 | Match Centre updates without refresh | **Not re-verified this phase** | Realtime plumbing (`useLiveScores.js`) unchanged since Phase 20/21 verification; no code in this phase touched it |
| 14-16 | Match finishes, final state settles, standings/prizes correct | **Not re-verified this phase** | `compute-scores`/`settle-gameweek` unchanged this phase; Pick 5's own scoring path is now correct for the first time (`ISSUE-69` fix) but not exercised against a real finished match |
| 17 | User can return later and see the completed result | Not re-verified this phase | Unchanged |
| 18 | No duplicate events exist | **Yes, schema-level guarantee re-verified** | `fixtureevents_uniq` constraint confirmed live and now migration-tracked (`ISSUE-70`) |
| 19 | No demo data appears | **Yes** | Confirmed `ws-live-events.js`'s `getLiveFixtures()` filters `.not('whoscored_fixture_id', 'is', null)`, and demo fixture generation (`_shared/demo/generateLeague.ts`) never sets that column — grepped, zero matches. Demo fixtures structurally cannot be picked up by the real worker |
| 20 | Normal users cannot access admin/super-admin functionality | Previously verified (Phase 20/21) | Unchanged this phase |

**Honest summary**: steps 8, 18, 19 have real, live evidence behind
them this phase. Steps 9-13 have the *mechanism* proven (page loads,
data extraction works, correct casing, correct dedup) but not an
actual live goal/card/substitution, because none has happened yet —
the season hasn't started. **The full acceptance test cannot be
completed until the first real Premier League match kicks off** —
recommend re-running steps 8-16 against that first real match as the
true, final proof, using the new `/health` endpoint plus a direct
`fixture_events` query to confirm.

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
3. Apply migrations 001 → 033 in order (§ 3) — includes 028's Realtime
   publication fix (§ 3a), 029/030's deadline consolidation (§ 3b), and
   031/032's Phase 22 fixes (the `fixture_events` uniqueness constraint
   and the `whoscored_fixture_id`/`whoscoredteamid`/`whoscoredplayerid`/
   `stats_*` columns — both previously out-of-band, now migration-
   tracked; a fresh project would be missing them without these).
   Confirm afterward via `select tablename from pg_publication_tables
   where pubname='supabase_realtime'` — expect `fixtures`,
   `fixture_events`, `pick5_picks`, `pot_standings_snapshots`.
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
6. Deploy every Edge Function listed in § 4, including the new
   `sync-live-scores` (Phase 22) — uses the same `FOOTBALL_DATA_KEY`
   secret as `sync-fixtures`, no new secret to provision.
7. Build and deploy the frontend, pointed at the correct `VITE_SUPABASE_URL`/
   `VITE_SUPABASE_ANON_KEY` for this environment.
8. Run the full smoke-test checklist: [SMOKE-TESTS.md](./SMOKE-TESTS.md).
9. Wait for (or manually trigger, via a signed-in Super Admin's "Manual jobs"
   buttons) one real tick of each cron job; confirm `net._http_response`
   shows `200` for each (not just `cron.job_run_details` showing
   `succeeded` — see § 6/§ 7 for why that alone is insufficient).
10. **Separately** (not part of the Supabase/Vercel sequence above):
    deploy the persistent WhoScored worker per § 6d, once a hosting
    decision is made. Not required for steps 1-9 to work correctly —
    fixtures, kickoffs, live scores, and final results all work without
    it (Phase 22); only live in-match events/goalscorers depend on it.

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

## 13. Known, not fixed Phase 20 (product decisions, not code bugs)

- **Fixture-ingestion provider/scheduling mismatch** — **resolved
  Phase 21**, see § 0, § 4, § 6c, and `decisions.md § Phase 21`.
- **Season-to-season rollover** — **decided Phase 21**: manual, by
  design, exact procedure documented in `decisions.md § Phase 21`.
  Not a beta blocker; no code needed.
- **`ISSUE-27`** (`PotDetail.jsx`'s data-loading effects have no
  stale-response guard) — re-confirmed still present, still low
  real-world likelihood at current usage patterns, still P2/tech-debt
  per its own existing classification in `current-state.md`. Not
  touched — no new evidence changed its risk assessment this phase.

## 14. Known, not fixed Phase 21 (flagged, out of this phase's scope)

- **`ISSUE-65`** — `fullSyncPlayers.js` hardcodes a stale `SEASON_ID`
  that doesn't match this project's real season. Not fixed this phase
  (out of the fixture-ingestion scope this phase prioritized); must be
  checked/patched before the next season rollover's player-sync step
  (`decisions.md § Phase 21 — Season rollover`, step 4).
- **WhoScored live-events pipeline has no hosting home** — **Phase 22
  update: hardened and a hosting recommendation made (Railway), but
  still not actually deployed anywhere** — see § 6d. Beta can launch
  without it (fixtures/kickoffs/live scores/final results are now all
  correct without this worker, per Phase 22's `sync-live-scores` fix;
  only live in-match events/goalscorers are affected).
- **`ISSUE-12`'s three-script overlap** (`fullSyncInsert.js`/
  `fullSyncPlayers.js`/`syncFootballData.js`) — `fullSyncInsert.js` is
  no longer purely dead (it's the season-rollover tool and the source
  `sync-fixtures` was ported from), but the underlying duplication
  across all three scripts was not consolidated this phase.

## 15. Known, not fixed Phase 22 (flagged, out of this phase's scope)

- **The persistent worker is not deployed anywhere** — hardened and a
  hosting recommendation made, but actually creating an account and
  deploying it is explicitly a manual action for the project owner
  (§ 0, § 6d) — not something this phase does unilaterally.
- **Event corrections beyond a non-key field update are not
  reconciled** — a WhoScored card upgrade (yellow → second yellow →
  red) changes `event_type`, which is part of the upsert's natural
  key, so it inserts a new row rather than correcting the old one. A
  full reconciliation pass was deliberately not built — real,
  non-trivial complexity this phase's own brief warns against
  over-engineering for a beta this size. See `decisions.md § Phase 22
  — Event corrections`.
- **VAR and injuries are not implemented as distinct event types for
  real fixtures** — no verified evidence WhoScored's `incidentEvents`
  feed exposes either in a way this script could reliably extract;
  not fabricated. `FixtureEventsTimeline.jsx` already documents this
  distinction (`var_review`/`injury` render only for the Demo Centre's
  synthetic data).
- **Half-time doesn't get a reduced polling cadence** — the worker
  polls every 60s uniformly from -10min to +130min of kickoff,
  including during half-time when nothing changes. A minor, known
  inefficiency, not fixed — would only save a handful of cheap polls
  per match and this phase's own instruction is to keep the lifecycle
  simple.
- **Full infrastructure sizing (memory/CPU under real concurrent-fixture
  load) could not be measured** — no live Premier League match exists
  yet to measure against. Recommend validating against the worker's
  own new `/health` endpoint during the season's first live matchday.
- **Graceful-shutdown signal delivery could not be live-verified** on
  the Windows development machine used this session — Windows itself
  refused a non-forced process termination. Code-reviewed as correct,
  standard Node.js practice; should be re-verified once running on the
  actual Linux production host.
