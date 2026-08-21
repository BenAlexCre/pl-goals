# Current State

Last reviewed: 2026-08-18 (Phase 9 — Demo Gameweek / Match Centre UX Enhancement).

This file is the **canonical, frequently-updated record of what's true about the
running system right now** — open bugs, unverified assumptions, half-built features,
repository hygiene issues. Everything on this page is expected to age. Check the "Last
reviewed" date above against recent commits before trusting it, and update this file
(per `CLAUDE.md`) whenever a significant feature lands, a bug here is fixed, or a new
one is found — see [session-log.md](./session-log.md) for the running record of when
that happens.

Stable facts (how the system is built, what a table means, what an endpoint does)
belong in [architecture.md](./architecture.md), [database.md](./database.md),
[api.md](./api.md), [features.md](./features.md), or [decisions.md](./decisions.md)
instead, and are only linked from here — not repeated. That split is the whole point
of this file: one place to check "is this still true," instead of a fact drifting out
of sync across five documents because it was only updated in one.

## How these documents fit together

| Document | Owns | Changes... |
|---|---|---|
| **current-state.md** (this file) | Open issues, unverified assumptions, what's confirmed working right now | Every session, whenever something is checked, fixed, or newly found |
| [session-log.md](./session-log.md) | Chronological record of *what happened in each session* | Every session (append-only) |
| [changelog.md](./changelog.md) | Chronological record of *what shipped* (features, fixes, migrations) | Whenever something ships (append-only) |
| [roadmap.md](./roadmap.md) | Prioritized plan for what to do about open issues, and unbuilt features | Whenever priorities change |
| [architecture.md](./architecture.md) | Stack, request flow, directory structure, security model — how the system is put together | Rarely — only when the structure actually changes |
| [database.md](./database.md) | Schema, RLS policies, triggers, cron jobs — reference material | Only with a new migration |
| [api.md](./api.md) | Edge function and external-API contracts — reference material | Only when an endpoint's behavior changes |
| [features.md](./features.md) | Inventory of what's reachable in the product today | Whenever a feature ships, is removed, or is found to be unwired |
| [decisions.md](./decisions.md) | Why non-obvious choices were made (ADR-style), append-only | Whenever a new non-obvious architectural choice is made |
| [project-board.md](./project-board.md) | Kanban work tracker (Backlog/Ready/In Progress/Blocked/Testing/Done), cards reference `ISSUE-N` ids | Every session — kept current by `/checkpoint` |
| [business-rules.md](./business-rules.md) | Product/business rules (when picks lock, how scoring and ties work, payment rules, permissions) — rules, not implementation | Only when an actual game/business rule changes, not when its implementation does |
| [engineering-principles.md](./engineering-principles.md) | Coding standards and conventions (folder structure, naming, React/Supabase/SQL patterns, error handling, testing) | Rarely — only when a convention changes |
| [game-engine.md](./game-engine.md) | **Authoritative forward-looking architecture spec** for the three-game-mode platform rebuild (Pick 5, Last Man Standing, Score Predictor) — shared entities, Game Engine contract, dispatcher, folder structure, sequence diagrams, invariants | Whenever a milestone lands or an architectural decision changes; cited by `GE-N` id |
| [schema-review.md](./schema-review.md) | Point-in-time architectural review of the Milestone 2 migrations (`004`/`005`) — findings ranked Critical/High/Medium/Low | Snapshot document — a new review gets a new file or a dated addendum, not a rewrite of this one |

A useful rule of thumb when you're not sure where something belongs: if the sentence
you're about to write starts with "right now..." or "as of today...", it belongs in
this file. If it starts with "the system is designed so that...", it belongs in
architecture/database/api/features. If it starts with "we chose X because...", it
belongs in decisions.md.

## Repository snapshot

- **Stack:** React 18 + Vite frontend, Supabase (Postgres + Auth + Edge Functions +
  `pg_cron`) backend. No custom application server. Full detail:
  [architecture.md](./architecture.md).
- **Product:** a private Premier League "goals pot" prediction game — full detail:
  [architecture.md § What this system is](./architecture.md#what-this-system-is).
- **Tests:** none exist (ISSUE-16 below).
- **CI/CD:** none found in the repo (no `.github/workflows/`, no other CI config).
- **Version control:** the repository has one clean commit, pushed to
  `origin/main` (`github.com/BenAlexCre/pl-goals`). The root `.gitignore` has been
  populated and the secrets/artifacts that were briefly committed have been removed
  from reachable history — see [Resolved issues](#resolved-issues), ISSUE-5 and
  ISSUE-14.
- **Strategic direction (updated 2026-08-09):** the product is being rebuilt as a
  three-game-mode platform (Pick 5, Last Man Standing, Score Predictor), all
  launch-quality, all first-class — see [game-engine.md](./game-engine.md), now the
  authoritative architecture spec. **Milestones 1–6 are backend-complete**:
  specification, shared schema design, Game Engine framework, and all eight
  `GameEngine` contract methods implemented, unit-tested, and live-verified for
  all three modes — see [game-engine.md § GE-12](./game-engine.md#ge-12-milestone-plan).
  **This is now the live, real-user path for Pick 5 only**, not just backend code:
  the frontend cutover (2026-08-05) rewired `PicksPage.jsx`/`PotDetail.jsx`/
  `GameweekPage.jsx` and their hooks onto `get-or-create-pick5-entry`/
  `submit-pick5-picks`/`game_entries`/`pick5_picks`/`pot_standings_snapshots`,
  verified end-to-end through the real UI. No frontend code creates a
  `user_entries` row anymore. **Last Man Standing and Score Predictor have zero
  frontend integration** despite complete, tested backends — see `ISSUE-33`
  below; this is now the single largest gap between "what the backend can do"
  and "what a real user can actually do." Phase 7 (Frontend Completion & Launch
  Readiness) Stage 1, 2026-08-09, is a full frontend/backend gap audit — no
  frontend code changed yet, see `ISSUE-33` through `ISSUE-37` below and
  [project-board.md](./project-board.md) for the prioritized punch list. The
  previously-undocumented `supabase_admin`-owned LMS/Predictor prototype
  tables/functions Milestone 4 replaces are treated as retired business-intent
  signal, not a preserved implementation — see
  [game-engine.md § GE-15](./game-engine.md#ge-15-explicitly-deferred--not-carried-forward).

## What's confirmed working

Confirmed by reading the code; **not** confirmed by running it against a live database
or browser (see the [Verification status](#verification-status) table for what's
actually been checked end-to-end):

- Auth (sign up / sign in / forgot password), session handling, protected routes.
- Browsing pots, members, gameweeks, and fixtures.
- The `/pot/:potId/picks` flow (`PicksPage` + `hooks/useEntry.js`) for building and
  submitting a 5-pick entry, with deadline and eligibility checks.
- The scheduled pipeline shape `sync-fixtures` (daily) → `compute-deadlines` (hourly)
  → `compute-scores` (every 3 min) → `settle-gameweek` (every 30 min) is internally
  consistent — *whether it produces correct live output* depends on ISSUE-2 and
  ISSUE-3 below, which are unverified.

## Issue register

Each issue has a stable `ISSUE-N` id — use it when cross-referencing from other
documents or from commit messages, instead of re-describing the issue. IDs are never
reused; when an issue is fixed, move its entry to
[Resolved issues](#resolved-issues) rather than deleting it, so the history of "this
was once broken" survives.

### P0 — verify or fix before building further on pots/scoring

#### ISSUE-19 — Cron-triggered Edge Function pipeline has a 100% failure rate
**Confirmed live**, 2026-08-03, via direct inspection of `cron.job_run_details`
(26,217 rows, back to the earliest recorded run on 2026-06-13): every cron job that
calls an Edge Function (`sync-fixtures-daily`, `compute-deadlines-hourly`,
`compute-scores-every-3-min`, `settle-gameweek-every-30-min`, both
`sync-live-events-*` variants) has failed **every single time it has ever run** —
e.g. `compute-scores-every-3-min` is 4,256/4,256 failed, `sync-live-events-every-2-min`
is 6,382/6,382 failed. Root cause: `app.settings.supabase_url` and
`app.settings.service_role_key` were never set on the database
(`ERROR: unrecognized configuration parameter`), and the newer Vault-secret variant
of the live-events job fails separately because `vault.decrypted_secrets` has zero
rows. The only job that has ever succeeded, `lock-due-entries-every-minute`, makes no
HTTP call at all — confirming the failure is specifically about the missing
settings/secrets, not RLS or application logic. Direct consequence: `fixture_events`
and `player_fixture_goals` are both empty — the entire scoring pipeline has never
processed real data. **This makes ISSUE-3's "matview never refreshed" concern moot in
practice** (there's nothing to refresh yet) but does not resolve it. **Status: partially resolved, one layer still open.** Both missing Postgres GUC
settings (`app.settings.supabase_url`, `app.settings.service_role_key`) are now set
and correct — confirmed via a real post-fix cron run returning a structured HTTP
response rather than a connection error. **A second, previously-masked root cause
was found and fixed**: `app.settings.supabase_url` initially pointed at
`http://127.0.0.1:54321` (host-only), which pg_net's in-container HTTP worker can't
reach — corrected to `http://kong:8000` (the Docker-internal address). **A third,
still-open root cause was found**: this local Kong instance requires an `apikey`
header to route to `/functions/v1/*`, but `003_cron_jobs.sql`'s `cron.schedule()`
calls only ever send `Authorization: Bearer` — every cron-triggered Edge Function
call is rejected with `401 Missing authorization header`, confirmed by direct
reproduction (a manually-added `apikey` header succeeds; the cron jobs' actual
headers do not). **Applied 2026-08-03**: `006_fix_cron_job_headers.sql` unscheduled and re-scheduled
the five affected jobs (new jobids 8–12) with both `Authorization` and `apikey`
headers. Confirmed via `net._http_response`: `compute-scores-every-3-min` returned a
real `200` on its first post-fix run — genuine end-to-end success, not just "cron
didn't error." `compute-deadlines-hourly` and `settle-gameweek-every-30-min` were
rescheduled identically. **Independently confirmed 2026-08-04** via `/health`:
both have since ticked and `succeeded` with real `net._http_response` rows
(`compute-deadlines-hourly` at each hour boundary, `settle-gameweek-every-30-min`
every 30 minutes) — no longer just "expected to succeed." `sync-fixtures-daily`
still hasn't ticked at a verification time (05:00 UTC schedule). `003_cron_jobs.sql` itself is
untouched, as required. `sync-live-events-every-2-min` will
continue failing even after this fix, separately, because the function it calls
doesn't exist (`ISSUE-4`) — confirmed via both a direct curl 404 and, now, a real
post-fix cron-triggered 404, distinguishing this from the
apikey issue. See `session-log.md` for the full investigation.

#### ISSUE-20 — Prototype tables have RLS disabled and full anonymous write access

**Narrowed, 2026-08-03.** The replacement schema (`004`/`005`) is now live:
`pot_prizes`, `game_entries` and its three per-mode children, `pot_standings_snapshots`,
and `notifications` all shipped with RLS enabled and correct policies from creation
— confirmed live, 10 policies across 7 tables, zero gap window. **The original
finding below still applies, unchanged, to the 7 old prototype tables specifically**
(`fixture_player_status`, `gameweek_pots`, `lms_entries`, `lms_picks`,
`predictor_entries`, `predictor_picks`, `whoscored_fixture_map_staging`) — they were
deliberately left untouched by `004`/`005` (per the "isolate, don't delete yet"
plan) and remain exactly as exposed as ever. Closing this fully requires
`deployment-checklist.md`'s Phase 8 (final removal of the isolated prototype
objects), not yet done.
**Confirmed live and still open.** `fixture_player_status`, `gameweek_pots`,
`lms_entries`, `lms_picks`, `predictor_entries`, `predictor_picks`, and
`whoscored_fixture_map_staging` all have `relrowsecurity = false` and full
`SELECT/INSERT/UPDATE/DELETE` grants to both `anon` and `authenticated` — meaning
anyone with the public (non-secret) anon key can currently read and write
`gameweek_pots.total_pot`, `lms_entries.payout_amount`/`status`, and
`predictor_entries.payout_amount`/`total_points` with no authentication at all. A
fix (enable RLS + minimum policies + revoke `EXECUTE` on the five related
non-`security definer` settlement functions and `lock_gameweek_entries()`) was
designed and approved but **could not be applied**: all of these objects are owned
by `supabase_admin`, and the project's `postgres` role has no privilege to alter
objects it doesn't own — see ISSUE-21. The subsequent strategic decision to rebuild
these game modes from scratch (see [game-engine.md](./game-engine.md)) means the fix
is now "replace, not patch," but **the live exposure has not been closed** — it
remains exploitable until the prototype objects are actually dropped or their
ownership is resolved. Treat as live and urgent independent of the Game Engine
rebuild's timeline.

**Fixed in local dev, 2026-08-06 (production hardening sprint) — re-verified
the ownership blocker empirically first** (`alter table
public.whoscored_fixture_map_staging enable row level security;` as
`postgres` fails live with `ERROR: must be owner of table
whoscored_fixture_map_staging`; `revoke` as `postgres` silently no-ops with
`WARNING: no privileges could be revoked`, since `postgres` isn't the
grantor either — confirmed via `pg_roles`: `supabase_admin` is
`rolsuper=true`, `postgres` is not). **This cannot be fixed via a normal
`postgres`-run migration in any environment with the same ownership split**
— not a gap in this project's migration authorship, a hard platform
permission wall. Local dev happens to allow a direct `psql -U
supabase_admin` connection (not available against a real hosted project),
which was used to apply and verify the fix locally:

```sql
-- The 6 genuinely dead prototype tables (no application code references any
-- of them — confirmed by repo-wide grep before applying).
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

-- fixture_player_status IS actively read by the frontend
-- (hooks/useEntry.js, hooks/useLiveScores.js) — needs a real SELECT policy,
-- not a full lockdown. Mirrors the exact policy shape/naming already used
-- for fixtures/teams/players (reference_data_read_<table>, authenticated
-- only, using (true)).
alter table public.fixture_player_status enable row level security;
create policy "reference_data_read_fixture_player_status"
  on public.fixture_player_status for select
  to authenticated
  using (true);
revoke insert, update, delete, truncate, references, trigger on public.fixture_player_status from anon, authenticated;
revoke select on public.fixture_player_status from anon;
```

Verified live, post-fix: an authenticated client can still read
`fixture_player_status` (0 rows currently, no RLS error); an anonymous
client is denied both read and write on it (`permission denied for table
fixture_player_status`); anonymous write to `lms_picks` (spot-checked) is
denied the same way. **This SQL still needs to be run, by someone with
`supabase_admin`-equivalent access, against every real (non-local-dev)
environment** — local dev's fix does not propagate anywhere by itself.
Local-only, not captured in any migration (a migration containing this SQL
would hard-fail under `postgres` on every environment with the same
ownership split, breaking the whole migration chain for anyone replaying
it — worse than leaving the gap documented here).

#### ISSUE-21 — `postgres` role cannot alter `supabase_admin`-owned prototype objects
**Confirmed live**, 2026-08-03. Every object identified as "missing migration" in the
drift investigation (7 tables, 11 functions, 1 debug view) is owned by
`supabase_admin`; every object defined in `supabase/migrations/001`–`003` is owned by
`postgres`. `postgres` is not a member of `supabase_admin` (by Supabase's own,
deliberate platform design — this isolation is normal, not a misconfiguration) and
has no privilege to `ALTER`/`DROP` anything `supabase_admin` owns, including enabling
RLS (ISSUE-20) or dropping the prototype tables to make way for
`004_game_engine_shared_platform.sql` (which recreates several of the same object
names — `game_type`, `predictor_cycle_mode`, `lms_status`-equivalent — and will
collide until the originals are removed). Most likely origin: these objects were
created through Supabase Studio's no-code Table Editor, which executes as
`supabase_admin` rather than the project owner's own `postgres` credential — see
`session-log.md` for the full investigation. **Status: unresolved, but scope is now
split into two tracks.** Track A — the four prototype columns added to the
otherwise-`postgres`-owned `pots` table (`game_type`, `entry_fee`, `end_gameweek_id`,
`predictor_cycle_mode`) — has **no ownership blocker**: `postgres` owns `pots` and
can drop them directly, confirmed safe since both live rows sit at column defaults.
Track B — the 7 tables, 11 functions, 1 debug view, and the 4 enum types those
columns/tables reference — genuinely needs the Supabase Dashboard's delete UI (same
privilege level that created these objects) or a Supabase support request. Blocks
both ISSUE-20's permanent fix and applying `004`/`005`. See `session-log.md` for the
full remediation plan, including which Dashboard surface to try first.

**New object class found in the same ownership split, 2026-08-06 (production
hardening sprint): `cron.job` rows, not just tables/types.** `lock-due-entries-every-minute`
(jobid 6) and, until fixed today, `sync-live-events-every-5-min` (jobid 7)
were both owned by `supabase_admin` (`cron.job.username`), not `postgres` —
confirmed via `select jobid, jobname, username from cron.job`. This is why
`006_fix_cron_job_headers.sql`'s own `cron.unschedule('sync-live-events-every-5-min')`
call — wrapped in `exception when others then null` to tolerate the job
simply not existing — silently swallowed a **different** error
(`could not find valid entry for job`, pg_cron's actual message when the
calling role doesn't own the job) as if it were that harmless case. The
migration's own comment already correctly identified this exact job as "a
redundant, differently-broken duplicate... already recommended for removal,"
but the removal never actually took effect, and nothing surfaced that
silently, since `DO` blocks don't report caught exceptions. Confirmed live:
`sync-live-events-every-5-min` was still active and failing on every run
(100% failure, 201/201 in `cron.job_run_details`) — a `null value in
column "url"` constraint violation from an empty `vault.decrypted_secrets`
table, not even reaching the network. **Fixed locally** via
`psql -U supabase_admin -c "select cron.unschedule('sync-live-events-every-5-min');"`
(succeeded instantly once run as the actual owning role) — `lock-due-entries-every-minute`
was left alone since it's functioning correctly (1009/1009 succeeded,
already documented as calling a harmless legacy SQL function on frozen
data). Same real-environment caveat as the RLS fix above: this specific
unschedule needs the same out-of-band action repeated wherever this
project is actually deployed; `006`'s own migration file is not modified
(the unschedule call it already contains is correct — it just can't
succeed under `postgres`'s privileges, the same wall this whole issue
describes) and should not be re-run either way, since migrations aren't
replayed.

**Execution attempt, 2026-08-03 (evening session):** ran the reviewed six-object
isolation transaction (2 type renames + 4 column drops) as a single `begin`/`commit`
block. It failed immediately on the first statement (`alter type public.game_type
rename ...`) with `must be owner of type game_type` — direct, repeated confirmation
that Track B's privilege gap is real and applies equally inside this local Docker
stack, not just a hosted project (local Supabase's Postgres image deliberately
mirrors the hosted platform's `postgres`/`supabase_admin` separation). The
transaction rolled back cleanly with zero side effects (verified). **Lesson for the
plan, not just a status update:** Track A (the 4 `pots` column drops) and Track B
(the 2 type renames) must not be combined into one transaction — Track A remains
immediately executable by `postgres`; Track B still needs the Dashboard/support
path. `deployment-checklist.md`'s Phase 4 has been corrected to reflect this.

**Resolved, 2026-08-03 (later the same evening).** Track B was completed via the
Supabase Dashboard: `game_type` and `predictor_cycle_mode` renamed to
`*_prototype_deprecated` (confirmed live, still `supabase_admin`-owned — renaming
doesn't change ownership, only frees the name). Track A followed immediately
(4 `pots` columns dropped, `postgres`-privileged, zero data loss — both rows still
present, still named "Ben Test"). `004_game_engine_shared_platform.sql` and
`005_game_engine_shared_platform_rls.sql` then applied with **zero errors across
every statement**. Full verification: 7 new tables, all `postgres`-owned; 14 FKs,
all correct (`restrict` on money tables, `cascade` on genuinely dependent child
rows); 21 indexes; 5 triggers (including the new contract-immutability trigger);
10 RLS policies across all 7 new tables, RLS enabled on all of them; every
pre-existing table's row count unchanged. **ISSUE-21's Track A and Track B are both
closed for the two colliding objects.** The 7 original prototype tables, 11
functions, 1 debug view, and 2 non-colliding types (`lms_status`,
`player_match_status`) remain untouched, exactly as the "isolate, don't delete yet"
plan intended — final removal is `deployment-checklist.md` Phase 8, not done here.

**Extends to `cron.job` too, confirmed 2026-08-03**: applying
`006_fix_cron_job_headers.sql` found the same split one level further — `cron.job`
has a `username` column, and `cron.unschedule(name)` only reaches jobs owned by the
calling role. `sync-live-events-every-5-min` (jobid 7) is `supabase_admin`-owned
(same as `lock-due-entries-every-minute`, jobid 6, which `006` never needed to
touch) and could not be removed by `postgres`. Low severity — it just keeps failing
on its pre-existing Vault error every 5 minutes, no data or security impact — but
folded into Track B's scope rather than treated as a separate issue.

#### ISSUE-2 — `fixture_player_status` table missing from migrations — **RESOLVED, see [Resolved issues](#resolved-issues)**
Migration `037_fixture_player_status.sql` (Phase 25, lineup status) now captures
this table's schema, and `ws-live-events.js` now actually populates it. Kept here,
struck through in spirit, per this doc's own "never delete resolved issues" rule —
full writeup in the Resolved section below.

#### ISSUE-4 — `sync-live-events` edge function is referenced but doesn't exist
`supabase/migrations/003_cron_jobs.sql` schedules a call to
`/functions/v1/sync-live-events` every 2 minutes, and `AdminDashboard.jsx` has a
button that calls it manually. No `supabase/functions/sync-live-events/` directory
exists anywhere in the repo. Endpoint-level detail:
[api.md § Referenced but not implemented](./api.md#referenced-but-not-implemented-sync-live-events).
The only code that actually populates `fixture_events` with live goals/cards/subs is
a set of Playwright scripts meant to be run manually on someone's machine
(`frontend/scripts/ws-live-events.js` and the `sync-whoscored-*` scripts), scraping
WhoScored.com — see [architecture.md § Three football data providers](./architecture.md#three-football-data-providers).
**Status: confirmed absent from the repo** (this is a directory-listing fact, not
something that needs live-database verification) — what's unverified is whether the
cron job is silently failing every 2 minutes in production, or whether it was
deliberately removed/replaced by the manual scraper workflow. Plan:
[roadmap.md § P0](./roadmap.md#p0--verify-or-fix-before-building-further-on-potsscoring).

**Phase 22 update (2026-08-19):** formally decided, not just left absent —
live event scraping needs a real Chromium browser, which cannot run inside
Deno's Edge Runtime, so `sync-live-events` was never buildable as an Edge
Function and should not be. The intended replacement is the persistent
Node/Playwright worker architecture documented in
[decisions.md § Phase 22](./decisions.md#phase-22--production-live-match-event-pipeline)
(`ws-live-events.js`, hardened this phase, run continuously on a separate
host). This migration-003 cron job itself is left untouched (never rewrite
a historical migration) and will continue to harmlessly `404` — this is
now explicitly expected, not an open question.

### P1 — features that are half-built or internally inconsistent

**Status: confirmed, not fixed.** This is the largest single gap between what
the backend can do and what a real user can do — see
[project-board.md](./project-board.md) for the prioritized implementation plan.
Plan: [roadmap.md § P1](./roadmap.md#p1--close-the-loop-on-features-that-are-half-built).

#### ISSUE-7 — Two pick-building flows enforce different eligibility rules
`PicksPage` (`/pot/:potId/picks`, via `components/picks/PickSelector.jsx`) allows
goalkeepers to be picked. `PotDetail.jsx`'s inline picker (`/pot/:potId`) explicitly
excludes them (`.neq('position', 'Goalkeeper')`), a rule that exists only in that one
component. Both flows independently query `available_players_by_gameweek`
(see [database.md § available_players_by_gameweek](./database.md#available_players_by_gameweek-view))
rather than sharing a single eligibility function. **Status: confirmed** (this is
directly readable from both components' source, no live verification needed). A user
who reaches the app through different links/pages can get a different eligible-player
list for the same gameweek. This is a symptom of ISSUE-10 (two parallel data-fetching
patterns), not an independent root cause. Plan:
[roadmap.md § P1](./roadmap.md#p1--close-the-loop-on-features-that-are-half-built).

**Partially addressed 2026-08-04, for the new implementation only.** Milestone 4
Slice 2's `Pick5Engine.validateEntry()`
(`supabase/functions/_shared/game-engine/pick5/engine.ts`) picks one rule and
enforces it server-side: **goalkeepers are excluded** — a decision made explicitly
for this slice (confirmed with the repo owner) rather than inherited from either
prototype flow.

**Correctness resolved 2026-08-05, as part of the Pick 5 frontend cutover** — both
`PicksPage.jsx` and `PotDetail.jsx` now submit picks through `submit-pick5-picks`
(`hooks/useEntry.js`'s `useSubmitPicks`, and `PotDetail.jsx`'s own `handleSaveEntry`),
which runs `Pick5Engine.validateEntry()` server-side regardless of which page was
used. A goalkeeper pick is now rejected the same way from either entry point —
verified live via the real UI. **What's left, purely cosmetic:** `PicksPage.jsx`'s
own player list (via `available_players_by_gameweek`, unfiltered) still lets a user
*select* a goalkeeper in the UI before the server rejects it, while `PotDetail.jsx`'s
list filters them out at the query level (`.neq('position', 'Goalkeeper')`) so the
option never appears. This is a UX inconsistency, not a business-rule bypass —
closing it (making `PicksPage.jsx`'s list filter goalkeepers too) is optional
cleanup, not a correctness fix.


#### ISSUE-17 — Leaderboard ranking has no tie-break rule
`settle-gameweek` ranks pot members purely by `picks_won` descending
(`.order('picks_won', { ascending: false })`, then a JS `.sort((a, b) => b.picks_won -
a.picks_won)`) with no secondary sort key anywhere in the query or the code. Two
members with equal `picks_won` receive different, sequential ranks based on whatever
order the rows happen to arrive in from Postgres — not a documented or deterministic
rule (submission time, season-long strike rate, alphabetical, or anything else).
Endpoint detail: [api.md § settle-gameweek](./api.md#post-functionsv1settle-gameweek).
**Status: confirmed** (readable directly from the edge function's source, no live
verification needed). Discovered while writing
[business-rules.md](./business-rules.md), which could not state a tie-break rule
because none currently exists in the system. Since pots involve real money (see
[business-rules.md § Payment rules](./business-rules.md#payment-rules)), an
undefined tie-break on the leaderboard is a fairness gap, not just a cosmetic one.

**Resolved in practice, 2026-08-05, via the Pick 5 frontend cutover** — as of this
date, no code path anywhere in the app creates a `user_entries` row anymore
(`PicksPage.jsx`/`PotDetail.jsx` both write through `get-or-create-pick5-entry`/
`submit-pick5-picks` into `game_entries`), so the ranking logic described above is
still present, unchanged, but no longer exercised by real traffic — it's effectively
dead code now, not a live fairness gap. The leaderboard a real user actually sees is
`Pick5Engine.generateStandings()`'s `pot_standings_snapshots`, which has had a real
tie-break rule since Milestone 4 Slice 6 (`rankWithTies()`, standard competition
"1224" ranking) and is now verified reachable through the real UI (`GameweekPage.jsx`'s
Standings section). Not moved to Resolved issues, since the legacy code itself
hasn't been removed — only superseded.
Plan: [roadmap.md § P1](./roadmap.md#p1--close-the-loop-on-features-that-are-half-built).

#### ISSUE-42 — `player_team_history` has players active on two clubs at once, corrupting the pick picker
**Discovered 2026-08-10**, Launch Readiness Sprint 2 (End-to-End Workflow
Audit), via a real, reproducible React duplicate-key warning in `PotDetail.
jsx`'s Pick 5 player picker for a real gameweek. Root-caused, not guessed:
`available_players_by_gameweek` joins through `player_team_history` filtered
to `is_active = true`; 158 players currently have **more than one**
`is_active = true` row, some — confirmed for 3 specific players used in this
session's live testing — on two different Premier League clubs
simultaneously (e.g. one player active on both Aston Villa FC and Chelsea
FC, for the same season, with no `left_at` date on either row marking a real
transfer boundary). A player physically cannot be contracted to two Premier
League clubs at once, so this is genuinely bad reference data, not a
legitimate club-vs-country dual-active case (those exist too — a player can
correctly be active for both their club and a national team — but this
finding is specifically same-competition duplicates). **Impact**: the same
real player appeared twice in the Pick 5 picker, under two different team
badges — confusing, and a React-unsupported duplicate-key render state.
**Not fixed at the data level** — correcting 158 players' historical team
association requires knowing which club is actually correct for each,
which is a data question for whoever owns the sync process, not something
to guess and silently overwrite. **Mitigated at the query-consumption
level** instead (`PotDetail.jsx`'s `dedupeByPlayerId()`, `usePlayers.js`'s
own inline dedupe): the picker can no longer render the same player twice
regardless of how many active team-history rows the view serves up, but the
underlying data is still wrong and will still mis-attribute which club's
fixture a duplicated player's pick is actually scored against until
corrected. **Status: confirmed, data issue open, UI symptom mitigated.**

#### ISSUE-44 — No player-facing payment status is shown anywhere in the frontend
**Discovered 2026-08-10**, Launch Readiness Sprint 2, while auditing the
player journey's own explicit "payment visibility" checklist item. Checked,
not assumed: grepped `PotDetail.jsx`, `LmsPotDetail.jsx`,
`PredictorPotDetail.jsx`, and every other player-facing surface for
`is_paid`/`Payment`/`Paid`/`Unpaid` — zero matches anywhere outside the
admin-only `AdminPayments.jsx`/`PaymentTable.jsx`. A player has no way to
see whether they themselves are marked paid or unpaid for a pot they've
joined — they'd only discover an unpaid status indirectly, by their entry
going void at scoring time. `business-rules.md`'s existing "a player's own
view is read-only: paid/unpaid status only" language describes an intended
design, not the current implementation — there is no read-only view at
all, paid or otherwise. **Not fixed this sprint** — building a new "your
payment status" UI element is net-new frontend surface, explicitly out of
this audit's "do NOT add new features" boundary; this is a confirmed gap
for a future slice to design and build, not a bug this audit's own rules
permit fixing. **Status: confirmed, open.**

**Phase 9 update (2026-08-18):** `Dashboard.jsx`'s redesign added a
Paid/Unpaid badge to each pot card (batched `entry_payments` read, see
`useDashboardPotStatus()` in `hooks/usePots.js`) — a player can now see
their own payment status for every pot at a glance from the homepage. This
narrows the gap but doesn't close it: `LmsPotDetail.jsx`/
`PredictorPotDetail.jsx`'s own headers still show nothing (Pick 5's
`PotDetail.jsx` already had `EntryStatusBar` from an earlier slice) — out
of Phase 9's scope, which touched picker UX, not payment surfaces.

#### ISSUE-39 — No gameweek anywhere in the seed data has `is_current = true`; the "current" season's Premier League has zero gameweeks
**Discovered 2026-08-09**, while live-verifying `ISSUE-34`'s pot-creation form
fix through the real browser UI. `select count(*) from gameweeks where
is_current` returns `0` — confirmed directly against the live local database,
not inferred. Worse, the Premier League league row belonging to the *current*
season (`leagues.id=1`, `season_id=1`, the one `seasons.is_current = true`
marks, and the one the frontend's league dropdowns label "— Current") has
**zero** `gameweeks` rows at all (`select count(*) from gameweeks where
league_id=1` → 0). The only Premier League gameweek/fixture data that
actually exists (38 gameweeks) sits under a second, separate Premier League
league row (`id=6`, `season_id=3`, not the current season) — the same
league/season combination every prior Milestone 4-6 slice's own live
verification scripts have been using all along, just never previously
compared against the "current" one a real UI selection would default to.

**Impact, confirmed, not theoretical**: `hooks/useGameweek.js`'s
`useCurrentGameweek()` (`.eq('is_current', true).single()`) fails with a
PostgREST `406`/`PGRST116` on every load — reproduced live on `Dashboard.jsx`,
which silently shows "No current gameweek" instead of surfacing an error (not
a crash, but the countdown-timer/current-gameweek banner never works). Any
organiser who picks the "— Current" league in the new pot-creation form
(`ISSUE-34`'s fix) gets a real league with a real season but zero gameweeks
to select as a start/end marker for LMS/Predictor — a dead end, distinct from
`ISSUE-34`'s own now-fixed scope.

**Status: confirmed, not fixed.** This is a live-database data-seeding fact,
not an application bug — correcting it via ad-hoc SQL outside any tracked
migration/mechanism would repeat the exact out-of-band-change pattern
`ISSUE-1`/`ISSUE-20`/`ISSUE-21`/`ISSUE-24` already warn against. Needs a
deliberate decision (point `is_current` at a real gameweek in the league/
season actually being used for verification, reseed the "current" season
with real gameweek data, or accept local dev's seed data is simply stale)
rather than a silent fix.

**Phase 9 update (2026-08-18):** the redesigned `Dashboard.jsx` hero now
handles this state deliberately — a "No active gameweek right now"
`EmptyState`, not a fabricated GW1 or a silent blank — confirmed live at
today's actual `is_current = false`-everywhere state, then separately
verified against the happy path via a temporary, fully-reverted
`is_current = true` toggle on one real gameweek (not a data fix, not left
in place). The underlying data gap itself is still open.

**Phase 21 decision (2026-08-19):** formally investigated (every read
and write site, both `seasons.is_current` and `gameweeks.is_current`)
and decided **intentionally left unused/legacy** — nothing in the
codebase has ever set either flag to `true` (only ever `false`), every
real consumer already has a working fallback that doesn't depend on it
(`useNextGameweek()`, `find(is_current) || find(upcoming) || [0]`
chains), and building a correct maintenance mechanism would introduce a
second, competing "what's current" source rather than fixing anything
broken today. Full reasoning, alternatives considered, and consequences:
[decisions.md § Phase 21 — `is_current`](./decisions.md#is_current-issue-39--decision).
**Status: confirmed, decision made, not fixed** — this is now a
deliberate design choice, not an open question.

### P2 — cleanup and consolidation (tech debt, not incorrect behavior)

#### ISSUE-65 — `fullSyncPlayers.js` hardcodes a stale `SEASON_ID`
**Discovered 2026-08-19, Phase 21**, while investigating the fixture-
ingestion architecture (`ISSUE-64`). `frontend/scripts/fullSyncPlayers.js`
hardcodes `SEASON_ID = 26`, which does not match this project's real
season id (`3` — the season all real leagues/gameweeks/fixtures
actually live under). Deliberately **not fixed this phase** — out of
the fixture-ingestion scope this phase's brief marked as most
important (fixtures/teams/kickoffs/status, not player/squad sync), and
fixing it safely needs more research into why `26` was originally
chosen before changing it. **Relevant before the next season rollover**:
step 4 of the manual rollover procedure
([decisions.md § Phase 21 — Season rollover](./decisions.md#season-rollover--decision))
explicitly calls out checking/patching this constant first, or player
data will sync into the wrong season. **Status: confirmed, not fixed.**

#### ISSUE-27 — `PotDetail.jsx`'s data-loading effects have no stale-response guard
**Discovered 2026-08-05**, during the production hardening sprint audit.
`PotDetail.jsx` has five separate `useEffect` hooks driving async loads
(`loadFilterSourceRows`, `loadPlayers`, `loadSavedEntry`, `loadMemberEntries`,
plus the initial `loadPot`/`loadMembers`/`loadGameweeks`), none of which guard
against out-of-order resolution — unlike `hooks/useAuth.js`'s auth-state effect,
which uses a `mounted` flag for exactly this reason. **Status: confirmed** (directly
readable from the effects' source — none check a cancellation flag or an
`AbortController` before calling `setState`). If a user changes the selected
gameweek quickly (e.g. picks GW1 then immediately GW2), and GW1's fetch resolves
after GW2's, GW1's stale data can overwrite the already-correct GW2 render. Low
real-world likelihood at current usage patterns (requires two selections within
one network round-trip), but genuinely reachable, not theoretical. Same root
cause as `ISSUE-10` (this component's imperative fetch style, not the shared
hook layer) — the correct fix is likely part of that same eventual conversion to
`hooks/`, not a standalone patch to five independent effects. Not fixed in the
hardening sprint (bigger than a small, low-risk change).

#### ISSUE-28 — Numerous undocumented, redundant RLS policies not captured in any migration
**Discovered 2026-08-05**, during a full live audit of `pg_policies` (not just the
policies documented in `002_rls_policies.sql`) as part of the production
hardening sprint. `pots`, `pot_members`, `user_entries`, `user_entry_picks`, and
`profiles` all have 2–6 more live policies than their migrations define — the
same out-of-band pattern already known from `ISSUE-1`, just more extensive than
previously documented there. Confirmed, table by table, that every one of these
extra policies is functionally redundant with an already-documented,
equally-or-more-permissive policy for the same command (RLS policies for the
same command are OR'd together, so a narrower duplicate never restricts
anything) — harmless to current security posture, but real drift between
`supabase/migrations/` and the live database, contradicting
`engineering-principles.md`'s "every schema change is a migration" rule and
making the migration history untrustworthy as a complete record. **Two
exceptions, both were NOT redundant and were fixed directly — see
[Resolved issues § ISSUE-30 / ISSUE-31](#resolved-issues).** Not fixed for the
harmless duplicates themselves — dropping ~15 policies safely requires
confirming each one individually adds no capability beyond its documented
sibling, which is more verification than a "small, low-risk" hardening pass
allows; recommend a dedicated cleanup pass, not a blind bulk drop.

**A third exception found and fixed, 2026-08-09, during Phase 7 Stage 2
Slice 2's own live verification of a new, more restrictive `pots` INSERT
policy** (`021_pots_require_active_league.sql`, the automatic
league-selection product rule's backend enforcement): two of `pots`'
undocumented duplicate INSERT policies — `"authenticated can create pots"`
and `"users can create own pots"`, both bare `with check (created_by =
auth.uid())` — were correctly classified "harmless" here in 2026-08-05,
since `pots_insert_authenticated`'s own check was identically permissive at
the time. That stopped being true the moment `pots_insert_authenticated`
became strictly more restrictive: RLS OR-combines same-command policies, so
these two duplicates silently let through exactly the inserts the new,
intentionally stricter policy existed to block — confirmed live via a real
REST insert against a league flipped to `is_active=false`, which succeeded
when it should have been rejected. Dropped both via
`022_drop_duplicate_pots_insert_policies.sql` (same drop-by-name pattern as
`012_drop_undocumented_rls_policies.sql`); re-verified live, same request
now correctly returns `403`. A concrete illustration of why "harmless
duplicate" classifications need re-checking whenever the policy they
duplicate changes, not just recorded once and assumed to age well.

#### ISSUE-10 — Duplicated data-fetching pattern
`pages/PotDetail.jsx` and `components/pot/potManager.jsx` re-implement data
fetching/mutation with local `useState`/`useEffect` + direct `supabase.from(...)`
calls, duplicating logic that already exists as TanStack Query hooks in
`hooks/usePots.js` and `hooks/useEntry.js`, which every other page uses. Structural
detail: [architecture.md § Two competing data-fetching patterns](./architecture.md#two-competing-data-fetching-patterns);
likely origin: [decisions.md § Two parallel data-fetching patterns](./decisions.md#apparent-drift-not-a-decision-two-parallel-data-fetching-patterns).
**Status: confirmed.** ISSUE-7 (diverging eligibility rules) is a direct consequence
of this duplication — every rule implemented in both places is a rule that can
silently diverge. Plan:
[roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

#### ISSUE-11 — Dead code, including a latent case-sensitivity import bug
**Phase 21 update (2026-08-19):** `lib/footballDataProvider.js` has
been **removed** — beyond being dead code, it read a `VITE_`-prefixed
football-data.org API key (`import.meta.env.VITE_FOOTBALL_DATA_KEY`),
which Vite would inline into the public client bundle the moment
anything imported it. A live secret-exposure risk sitting in the
codebase, not merely unused code, so it was deleted outright rather
than left for a future cleanup pass. See
[decisions.md § Phase 21 — Client-bundle secret exposure](./decisions.md#client-bundle-secret-exposure--found-and-fixed).
The remaining three files below are unchanged, still dead, still
out of scope.

`components/entryBuilder.jsx`, `lib/gameAPI.js`, and
`lib/whoScored.js` have no importers anywhere in the reachable app (confirmed by
grepping for each module's name across `frontend/src`). `entryBuilder.jsx` additionally
imports `from '../lib/gameApi'` (lowercase `Api`) when the actual file is
`lib/gameAPI.js` (uppercase) — this resolves on case-insensitive filesystems (Windows,
default macOS) but would fail to resolve on a case-sensitive one (Linux — i.e. most CI
runners and production containers), so this component would break a Linux build the
moment anything imports it. `lib/whoScored.js` is additionally misplaced: it's a
Node/Playwright script (not browser code) sitting inside the Vite-bundled `src/lib`
tree. The two RPCs `gameAPI.js` calls, `get_or_create_entry` and `save_entry_picks`,
are also absent from the migrations (see [database.md § Schema drift](./database.md#schema-drift))
— lower priority than ISSUE-2 since this code path is unreachable today. **Status:
confirmed.** Plan: [roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

**Extended, 2026-08-09, during the Phase 7 Stage 1 audit — five more confirmed-dead
exports/components found, same pattern (grepped for importers across
`frontend/src`, zero found for each):** `hooks/usePick5Entry.js` (its own
comments admit "not wired into any page yet" — superseded in practice by
`hooks/useEntry.js` and inline logic in `PotDetail.jsx`); `useAdminAction`
(exported from `hooks/useAdmin.js`, no importers); `usePot` (exported from
`hooks/usePots.js`, no importers — `useCreatePot`, its sibling export, was
also dead at the time of this audit, but was extended and wired into
`potManager.jsx` as part of fixing `ISSUE-34` the same day, so it no longer
belongs on this list); `components/admin/MemberTable.jsx`
(see `ISSUE-8`'s update); `components/leaderboard/LeaderboardCard.jsx` (a
`PICK5_PICK_COUNT`-hardcoded sibling of the actually-used `LeaderboardTable.jsx`,
never imported). Also found: the `/pot/:potId/picks` route (`PicksPage.jsx`) is
itself orphaned — routed in `App.jsx` but no `Link`/navigation anywhere in the
app points to it; `PotDetail.jsx`'s own inline pick-builder is the only reachable
Pick 5 pick-submission surface today. None of this is a correctness bug (nothing
reachable is broken), purely unreachable/unused code — same cleanup-tier
classification as the original four files above.

#### ISSUE-12 — Overlapping, unused football-data.org sync scripts
Three standalone Node scripts (`frontend/scripts/fullSyncInsert.js`,
`fullSyncPlayers.js`, `syncFootballData.js`) each independently implement
similar-but-not-identical upsert logic against football-data.org v4, none of them
invoked by the running app, cron, or any edge function. See
[architecture.md § Three football data providers](./architecture.md#three-football-data-providers)
and [decisions.md § Provider abstraction was planned but never completed](./decisions.md#provider-abstraction-was-planned-but-never-completed)
for how this relates to the now-removed `footballDataProvider.js` abstraction
(`ISSUE-11`).

**Phase 21 update (2026-08-19):** `fullSyncInsert.js` is no longer
purely "unused" — its exact logic was ported into the production,
cron-scheduled `sync-fixtures` Edge Function (`ISSUE-64`), and the
script itself is now the documented manual-rollover tool
([decisions.md § Phase 21 — Season rollover](./decisions.md#season-rollover--decision)),
not dead weight. `fullSyncPlayers.js` remains standalone/manual-only
(and has its own separate, flagged bug — `ISSUE-65`). `syncFootballData.js`
is unchanged, unexamined this phase, still presumed dead. The
three-script *overlap* this issue describes is otherwise unchanged —
not consolidated this phase, out of scope. **Status: confirmed.** Plan:
[roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

#### ISSUE-13 — Duplicate `.env` files
A root-level `.env` and `frontend/.env.local` contain the same keys (Supabase URL/
anon key/service-role key, football-data.org key, competition code/season). The root
copy doesn't appear to be read by anything — see
[architecture.md § Environment configuration](./architecture.md#environment-configuration)
for the reasoning. Related to, but distinct from, the more urgent security question
in ISSUE-5 (the root copy isn't gitignored). **Status: confirmed.** Plan:
[roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

#### ISSUE-38 — `sync-fixtures/index.ts` fails `deno check` with 31 pre-existing type errors
**Discovered 2026-08-09**, during Phase 7 Stage 1's baseline verification pass
(run before any frontend work, to confirm the starting point was clean — not
part of the frontend audit itself). Ran `deno check` against every Edge
Function's `index.ts` individually: all ten Game-Engine-era functions
(`admin-actions`, `compute-deadlines`, `compute-scores`, `settle-gameweek`,
the three `get-or-create-*-entry`, the three `submit-*-pick*`) pass cleanly.
`sync-fixtures/index.ts` alone fails with 31 errors (`TS2339 Property '...'
does not exist on type '{}'`, `TS18046 'error' is of type 'unknown'`) — mostly
untyped Supabase query results and un-narrowed `catch (error)` blocks.
Confirmed via `git log --oneline -- supabase/functions/sync-fixtures/index.ts`
that this file has never been touched since the initial commit — it predates
the Game Engine rebuild's TypeScript discipline entirely and was never
brought up to the same standard. **Status: confirmed, not fixed** — out of
Phase 7 Stage 1's scope (frontend integration), and not a correctness bug
(the function runs correctly at the JS runtime level regardless of type
errors; no CI enforces `deno check`, per `ISSUE-16`) — flagged as a P2
cleanup item, same tier as `ISSUE-11`.

#### ISSUE-18 — `useAuth.js` logs the signed-in user's email to the browser console
`hooks/useAuth.js`'s `onAuthStateChange` handler calls `console.log('auth changed',
session?.user?.id, session?.user?.email)` on every auth state change. Low severity —
visible only to the signed-in user in their own browser devtools, not exposed to
anyone else — but it's a debug statement that shouldn't have shipped, and it's the
kind of thing [engineering-principles.md § Logging](./engineering-principles.md#logging)
now exists to prevent recurring. **Status: confirmed.** Plan:
[roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

### P3 — known product gaps (unbuilt, not broken)

#### ISSUE-37 — No notifications UI exists for any game mode
**Discovered 2026-08-09**, during the Phase 7 Stage 1 audit. All three engines'
`notifyUsers()` methods are implemented and write real `notifications` rows on
every prize payout (`pick5.prize_awarded`/`lms.prize_awarded`/
`predictor.prize_awarded`) — per
[decisions.md § Notifications: domain events, not delivery](./decisions.md#notifications-domain-events-not-delivery),
this was always deliberately scoped as domain-event emission only, with
delivery/display explicitly deferred. Confirmed, not just re-stated: grepped
`notifications` (case-insensitive) across all of `frontend/src` — zero matches,
no bell icon, no inbox page, no query against the table, for any mode,
including Pick 5 (whose notifications have existed since Milestone 4 Slice 9).
Consolidates the three separate "No frontend UI for X notifications"
project-board Ready-column notes (previously LMS/Predictor-only) into one
issue that also covers Pick 5, since the gap is actually platform-wide, not
per-mode. **Status: confirmed, unbuilt by design so far — see
[game-engine.md § GE-15](./game-engine.md#ge-15-explicitly-deferred--not-carried-forward)**,
which already deferred "notification delivery mechanism" to Milestone 7; this
issue specifically covers the simpler in-app inbox/list UI for the
already-written rows, not email/push/SMS delivery.

#### ISSUE-16 — No automated tests
No test runner is configured in `frontend/package.json` (no `test` script, no Jest/
Vitest/Playwright-test dependency — Playwright is present only as a scraping tool,
see [architecture.md § Three football data providers](./architecture.md#three-football-data-providers)),
and no `*.test.*`/`*.spec.*` files exist anywhere in the repo. **Status: confirmed.**
Given how much business logic lives in RLS policies, triggers, and edge functions
(see [database.md § Functions & triggers](./database.md#functions--triggers)), this is
a real regression risk with no safety net. Plan:
[roadmap.md § P3](./roadmap.md#p3--known-product-gaps-unbuilt-not-broken).

## Resolved issues

#### ISSUE-2 — `fixture_player_status` table missing from migrations
**Discovered 2026-08-03, resolved 2026-08-21, Phase 25 (lineup status).**
Migration `037_fixture_player_status.sql` captures the table as it already
lived on this project's database (confirmed column-for-column via the
PostgREST OpenAPI schema and live insert/upsert probes before writing a
single line — the `player_match_status` enum and `unique(fixture_id,
player_id)` constraint the whole ingestion strategy depends on both
already existed). **Real, live-blocking finding along the way**: the
table was owned by `supabase_admin`, not `postgres` (the role every
normal migration — this one included — runs as; confirmed `postgres` has
`rolsuper=false` in this image, only `supabase_admin` is a true
superuser), so `CREATE INDEX`/`ENABLE ROW LEVEL SECURITY`/`CREATE
POLICY`/`CREATE TRIGGER` all failed with "must be owner" until a one-time
`alter table ... owner to postgres` was run via a `supabase_admin`
session — the same out-of-band-ownership class of issue this project
already hit once with the retired prototype's own `supabase_admin`-owned
`predictor_picks` table. **If this table exists with the same anomaly on
any other deployment of this project, that environment needs the
identical one-time ownership fix before this migration will apply
there.** Ingestion: `ws-live-events.js`'s new `parseLineup()` reads
`matchData.home/away.players[].isFirstEleven` (real WhoScored data,
confirmed live-verified `matchCentreData` is the literal JSON `null`
until official lineups are published — already handled by this script's
own existing null-check, so lineup rows are never written before
lineups are genuinely confirmed) to set the STABLE `status`
(starting/bench)/`started` fields, never regressing a player already
advanced to `sub_on`/`sub_off` by `applySubstitutionUpdates()` (which
cross-references the same `fixture_events` this script already parses,
touching only `came_on_minute`/`went_off_minute` + the event-state
`status` value, never `started`). `computeNotInSquadRows()` marks any
active `player_team_history` roster player missing from a CONFIRMED
team's squad list as `not_in_squad` — never applied to a team whose
lineup isn't confirmed yet. Full detail:
[decisions.md § Phase 25 (lineup status)](./decisions.md#phase-25-lineup-status--fixture_player_status-ingestion).
Real, previously-unnoticed frontend bug fixed in the same phase:
`PlayerCard.jsx` collapsed BOTH `sub_on` and `sub_off` to a "Bench" badge
— a starter subbed off was shown as Bench, contradicting their actual
Starting XI status. Now `sub_off` correctly collapses to "Starting XI".
Live-verified end to end (Score Predictor goalscorer picker AND Match
Centre's Lineups tab, which had never consumed this data at all before
this phase) via a real simulated lineup (36 starters/bench + 20
not-in-squad across both teams of a real fixture, a simulated
substitution in both directions, and a repeated "next poll cycle" upsert
proving no duplicate rows and no status regression) — test data fully
removed afterward.

---

#### ISSUE-69 — `ws-live-events.js` wrote `event_type` in the wrong case, silently guaranteeing zero Pick 5 goals ever
**Discovered and resolved 2026-08-19, Phase 22 (Production Live-Match
Event Pipeline)**, while auditing event idempotency. `mapEventType()`
returned SCREAMING_SNAKE_CASE (`'GOAL'`, `'YELLOW_CARD'`, ...), but
every real consumer of `fixture_events.event_type` — `business-rules.md`'s
own documented rule, the Match Centre views
(`025_match_centre_views.sql:108,119,126-127`), the demo pipeline's own
CHECK constraint (migration 026), and `FixtureEventsTimeline.jsx`'s
`EVENT_ICON` lookup — uses lowercase snake_case. **Impact, precisely
traced**: Pick 5 scoring reads `player_fixture_goals`, a materialized
view filtered on `fe.event_type in ('goal', 'penalty') and not
fe.is_own_goal` — an uppercase `'GOAL'` row would never match. Even a
fully working, unblocked, correctly-deduplicated scrape would have
silently scored **zero goals for every player, forever**, with no
error anywhere — the single most severe bug found this phase, more
consequential than the idempotency or hosting questions, since it
would have broken Pick 5 scoring invisibly the moment the worker ran
for real. LMS/Predictor were unaffected (they read
`fixtures.home_goals`/`away_goals` directly). **Fixed**: `mapEventType()`
now returns the correct lowercase values; `parseEvents()`'s `tracked`
Set updated to match. Full detail:
[decisions.md § Phase 22](./decisions.md#critical-bug-found-and-fixed--issue-69-event_type-casing-mismatch).

---

#### ISSUE-68 — Nothing updated `fixtures.status`/`home_goals`/`away_goals` during a live match
**Discovered and resolved 2026-08-19, Phase 22**, tracing how a goal
would actually reach the UI. `sync-fixtures` (Phase 21) runs once
daily; `ws-live-events.js` (the WhoScored worker) has never had any
code path touching the `fixtures` table — confirmed by reading its
full source, it only ever wrote `fixture_events`. `FixtureCard.jsx` and
the LMS/Predictor Game Engine both read `fixtures.home_goals`/
`away_goals`/`status` directly, not anything derived from
`fixture_events`. Result: **no live score, in-play status, or LMS
"currently winning"/Predictor live-scoreline could have worked at
all**, independent of any WhoScored-specific issue. **Fixed**: new
Edge Function `sync-live-scores`, football-data.org-sourced (the
existing authoritative provider for these exact fields, not a new
data source), scheduled every minute (migration 033) but only actually
calling out to the API when a local, free DB check finds something
relevant — safe to run continuously. Live-verified via a reversible
fixture-window perturbation: real call made, real response received,
fully reverted with the GW1 deadline confirmed byte-for-byte unchanged
afterward. Full detail:
[decisions.md § Phase 22](./decisions.md#the-most-important-finding-nothing-updated-live-scores-at-all).

---

#### ISSUE-70 — `fixture_events`' real unique constraint existed only out-of-band, not in any migration
**Discovered and resolved 2026-08-19, Phase 22.** Verified against the
live database directly (not just the migrations): `fixture_events`
already has a working `fixtureevents_uniq UNIQUE (fixture_id,
event_type, minute, team_id, player_id)` constraint, and
`ws-live-events.js`'s upsert already correctly targets it — the
application code was never actually broken. But no migration created
this constraint; `001_initial_schema.sql` instead declares `unique
(fixture_id, provider_id)`, absent from the live database entirely. A
fresh hosted project built purely from tracked migrations would be
missing this constraint, and every upsert call would fail (caught and
logged, not thrown — appearing to run while silently writing zero
events). **Fixed**: `031_fixture_events_uniqueness.sql`, formalizing
the constraint the application already depends on, guarded to replay
safely regardless of starting state. Same class of gap as `ISSUE-21`/
`ISSUE-24`/migration 028's realtime-publication drift.

---

#### ISSUE-71 — `whoscored_fixture_id`/`whoscoredteamid`/`whoscoredplayerid`/`stats_*` columns existed only out-of-band, not in any migration
**Discovered and resolved 2026-08-19, Phase 22**, while tracing
`ISSUE-70`. `fixtures.whoscored_fixture_id`, `teams.whoscoredteamid`,
`players.whoscoredplayerid`, and `fixtures.stats_status`/
`stats_last_synced_at`/`stats_next_sync_at`/`stats_finalized_at`/
`finished_at` all exist live, all indexed live, and none exist in
`001_initial_schema.sql` or any later migration. A fresh hosted
project would be missing the very columns the entire WhoScored
pipeline reads and writes — every mapping script and
`ws-live-events.js` itself would fail immediately with "column does
not exist." The `stats_*` columns are unread/unwritten by any current
application code (confirmed by grep) — kept as-is, not given new
behavior, since dropping a column is destructive and there's no
evidence of their original purpose. **Fixed**:
`032_whoscored_and_stats_columns.sql`, purely additive, `IF NOT
EXISTS` throughout. Applied locally — no-op against this project's own
already-drifted database, real column adds on a fresh one.

---

#### ISSUE-72 — `ws-live-events.js` had no retry, no graceful shutdown, no health signal, and defaulted to a display-requiring browser mode
**Discovered and resolved 2026-08-19, Phase 22**, auditing the worker
for production-hosting readiness. Found: a single failed page load
cost an entire fixture for the whole 60s cycle (no retry); an uncaught
error anywhere in the main loop killed the whole process
(`process.exit(1)`, no per-cycle isolation, no supervisor); no
`SIGTERM`/`SIGINT` handler, so a host restart couldn't close the
browser context cleanly; no way to ask the worker "are you alive, what
are you doing" short of reading raw logs; `headless:false` hardcoded,
which cannot run at all on a typical headless VPS/container without a
virtual display. **Fixed**: one retry (5s delay) per fixture per
cycle; per-cycle try/catch so one bad cycle doesn't kill the process;
real `SIGTERM`/`SIGINT` handling closing the browser context and
health server; a new `GET /health` endpoint (worker status, uptime,
active fixture count, last successful scrape, last DB write, last
error); `headless` now configurable via `WS_HEADLESS` (default `false`,
preserving the evidenced-working anti-Cloudflare-detection posture —
see `decisions.md` for why headless wasn't made the default). **Not
fixed**: browser-process-crash recovery is deliberately left to the
host's own supervisor (Railway/Render/Fly.io/`systemd` auto-restart),
not handled in-process — matches this phase's own "keep it simple, do
not over-engineer" instruction. Graceful-shutdown signal delivery
could not be live-verified on this Windows dev machine (Windows itself
refused a non-forced `taskkill`) — code-reviewed as correct, standard
Node.js practice; should be re-verified on the actual Linux production
host.

---

#### ISSUE-64 — `sync-fixtures` called a provider with no working key, and had a season-resolution bug that would have synced real data into the wrong season anyway
**Discovered and resolved 2026-08-19, Phase 21 (Beta Architecture
Decisions + Deployment Preparation), during the fixture-ingestion
provider comparison this phase's brief marked most important.** The
cron-scheduled `supabase/functions/sync-fixtures/index.ts` called
api-football (`v3.football.api-sports.io`) and had never successfully
run in this environment (`sync_runs` history: repeated `failed`,
`0 processed` — no working key). Reading the function's actual source
(not just re-citing the known key gap from Phase 16/20) found a second,
independent, previously-undiscovered bug: it resolved "the" season via
`.eq('is_current', true).single()`, which on this project's own real
data points at season id=1 — zero real leagues or gameweeks (see
`ISSUE-39`). Even with a working key, this function would have silently
created/synced real fixtures into a wrong, parallel season rather than
updating the one every pot/gameweek/fixture actually lives under
(id=3).

**Fixed**: rewrote the function to call football-data.org, porting
`frontend/scripts/fullSyncInsert.js`'s exact, already-proven logic
(Phase 19's `'tbd'`/15-minute-offset fixes included) — the provider
that has actually populated every real fixture this project has ever
had. Season resolution now uses an explicit `year_start`/`year_end`
lookup (matching `fullSyncInsert.js`'s own pattern), never
`is_current`. Same Edge Function, same existing `sync-fixtures-daily`
cron entry, same auth model (`_shared/adminOrCronAuth.ts`, unchanged)
— no new function, no new cron job, no new provider introduced. Full
comparison and the resulting one-source-of-truth table:
[decisions.md § Phase 21](./decisions.md#phase-21--beta-architecture-decisions--deployment-preparation).

**Verified**: `deno check` 0 errors (down from the old file's 31,
`ISSUE-38`); `deno test --allow-all` 347/347 unchanged; a real HTTP
call via a temporary local `supabase functions serve` process against
the real football-data.org API returned
`{"success":true,"processed":438,...}` (exact match: 20 teams + 38
gameweeks + 380 fixtures). Post-call DB check: no duplicate season/
league created, real counts unchanged, and GW1's `deadline_utc` still
exactly 15 minutes before `earliest_kickoff_utc` — confirming Phase
19's `refresh_gameweek_deadlines()` trigger fires correctly on this
function's writes. `sync_runs` logged `status='success'`,
`records_processed=438`.

---

#### ISSUE-67 — React Query Devtools shipped unconditionally to every visitor
**Discovered and resolved 2026-08-19, Phase 21**, during the final
new-user beta UX pass (section 9 of the phase brief). `main.jsx`
rendered `<ReactQueryDevtools initialIsOpen={false} />` unconditionally
— `initialIsOpen={false}` only keeps the panel closed by default, it
does not remove the floating toggle button, which was visible to every
real beta user regardless of environment. **Fixed**: gated behind
`import.meta.env.DEV`, which Vite statically replaces at build time,
so the devtools code is fully eliminated from the production bundle,
not merely hidden. **Verified**: `npm run build` clean.

---

#### ISSUE-66 — Every Premier League gameweek was named "REGULAR SEASON" instead of "Gameweek N"
**Discovered and resolved 2026-08-19, Phase 21**, during the final
new-user beta UX pass — the gameweek/leaderboard page's `<h1>` read
"REGULAR SEASON" with no gameweek number anywhere on the page,
confusing for a new user. Traced to the ingestion layer's own
`gwName()` helper (present identically in both
`frontend/scripts/fullSyncInsert.js` and, since `ISSUE-64`'s rewrite,
`supabase/functions/sync-fixtures/index.ts`): it used
`match.stage.replaceAll('_', ' ')` whenever football-data.org supplied
a `stage`, and Premier League matches always carry `stage:
'REGULAR_SEASON'` even in normal league play (`stage` isn't unique to
cup/knockout competitions) — so every one of the 38 real gameweeks was
named from that raw stage string, never falling through to the
intended `Matchday ${number}` fallback. Root-caused at the ingestion
layer rather than papered over in the frontend, matching this
project's own established Phase 19 precedent. **Fixed**: both
`gwName()` implementations now special-case `stage === 'REGULAR_SEASON'`
→ `` `Gameweek ${number}` ``, matching this app's own established
terminology ("Gameweek 1", not "Matchday 1", throughout the UI and
docs); other stages (group/knockout, not currently used by the real
Premier League league but preserved for correctness) still get the
human-readable stage name. **Verified**: `deno check` 0 errors, `deno
test --allow-all` 347/347 unchanged. **Not yet applied to the 38
already-synced real gameweek rows** — the existing `sync-fixtures`
upsert already writes `name` on every call, so the next scheduled
daily cron tick (or any manual re-run) self-corrects all 38 rows
automatically; no separate backfill or one-off script was written or
run, since it wasn't necessary and running an extra unscheduled live
sync against the real database wasn't part of what this phase asked
for.

---

#### ISSUE-63 — No top-level error boundary; an uncaught render error would blank the entire app
**Discovered and resolved 2026-08-19, Phase 20 (Beta Readiness /
Production Hardening Audit).** Found while auditing error handling for
"blank screens/silent failures" per this phase's own explicit checklist
— confirmed via grep that no `ErrorBoundary`/`componentDidCatch` existed
anywhere in `frontend/src`. Without one, React's default behavior for
any uncaught error thrown during render is to unmount the entire tree —
a real user hitting any unexpected render-time exception would see a
blank white page with no recovery path, not a graceful degradation.
Every other unhappy-path in this app already has a real, styled
fallback (`NotAuthorized.jsx`, `NotFound.jsx`, `EmptyState`) — this was
the one gap above all of them.

**Fixed**: new `frontend/src/components/ErrorBoundary.jsx` (a class
component — React error boundaries cannot be function components/hooks,
confirmed against React's own API constraints, not a stylistic choice),
wrapping `<App/>` in `main.jsx`. Matches the existing
`NotAuthorized.jsx` visual pattern (`EmptyState` + a real action button)
rather than inventing new UI language. Deliberately minimal: logs to
`console.error` for local/hosted-log debugging, offers a "Reload page"
button — not a monitoring platform, per this phase's own explicit "do
not build a large monitoring platform" instruction.

**Verified**: `npm run build` clean; live-tested normal navigation
across Dashboard/pot pages afterward — zero console errors, confirming
the boundary doesn't interfere with normal rendering. Not verified via
a forced live crash (would require contrived throw-during-render code
serving no other purpose) — correctness verified via code review of a
standard, well-established React pattern instead.

---

#### ISSUE-62 — Unconfirmed future fixture kickoff times displayed as a fabricated `00:00`
**Reported and resolved 2026-08-19, Phase 19 (mid-session addition,
during the Pick Lock Deadline Correction audit).** Reported live:
future gameweeks showed every fixture at `00:00`, and the Dashboard
header showed a "Gameweek starts ... at 00:00" that read as a real,
confirmed kickoff.

**Root cause, confirmed against the live provider API before touching
anything** (not assumed): football-data.org distinguishes `TIMED`
(kickoff time confirmed, a real hour/minute) from `SCHEDULED` (only the
date is known; broadcasters haven't set an exact time yet) — sent with
`utcDate` at a literal `00:00:00Z` placeholder for the latter, confirmed
by fetching a real distant matchday directly. api-football has the
equivalent distinction (`NS` vs `TBD`). Both of this project's ingestion
paths (`frontend/scripts/fullSyncInsert.js`,
`supabase/functions/sync-fixtures/index.ts`) collapsed both statuses
into the same `'scheduled'` `fixture_status` value, discarding the exact
signal needed to tell "confirmed" from "not yet confirmed" apart. The
schema already had the right representation for this —
`fixture_status`'s `'tbd'` enum value, already read by
`Dashboard.jsx`/`useMatchCentre.js`, just never populated by either
ingestion path. **Root cause: ingestion**, not the database schema, not
presentation alone — confirmed by tracing the actual data flow rather
than assumed, per the explicit instruction not to just hide `00:00` in
the frontend.

**Fixed**: `fixtureStatus()` (`fullSyncInsert.js`) and
`mapFixtureStatus()` (`sync-fixtures/index.ts`) now map the
provider's own "date-only" status to `'tbd'` instead of `'scheduled'` —
no schema change, the enum value already existed. New
`formatFixtureKickoff(kickoffUtc, status)` (`utils/time.js`) is the one
shared place that turns `status === 'tbd'` into "Time TBC" — used by
all four fixture-kickoff-display consumers (`FixtureCard.jsx`,
`PredictorFixtureCard.jsx`, `MatchCentreDrawer.jsx`,
`LmsFixtureSelector.jsx`), never inferred from a bare `00:00` time
(which a genuinely confirmed midnight kickoff would also produce).
`refresh_gameweek_deadlines()` (migration 030) now also excludes `'tbd'`
fixtures from the earliest-kickoff/deadline calculation — a gameweek
where every fixture is still unconfirmed correctly gets
`earliest_kickoff_utc`/`deadline_utc = null` rather than a fabricated
midnight-derived deadline. `Dashboard.jsx`'s `resolveGameweekState()`
was already changed in this same phase (see `ISSUE-24`'s resolution) to
trust `gw.earliest_kickoff_utc` directly instead of recomputing from
fixtures client-side — this meant the "Time TBC" fix for the
gameweek-level header/sidebar required no separate frontend
recalculation, only correct `null`-handling copy ("Time TBC" instead of
"Not yet scheduled", no `CountdownTimer` rendered when null — both
already gated correctly by existing conditionals).

**Verified live**: re-ran `fullSyncInsert.js` with the corrected
mapping — confirmed gameweeks 10+ (previously all `'scheduled'` with
identical midnight timestamps) now correctly show `'tbd'`; confirmed via
direct query that `refresh_gameweek_deadlines()` now leaves those
gameweeks' `earliest_kickoff_utc`/`deadline_utc` `null` instead of a
midnight-derived value. Live-tested Gameweek 10: Dashboard header shows
"Gameweek starts / Time TBC" and "Picks lock / Time TBC" with no
countdown; sidebar shows the same; fixture cards show "Sat, 7 Nov ·
Time TBC" (date preserved, time correctly replaced); Score Predictor and
the Match Centre drawer both show identical text for the same fixture.
Re-confirmed Gameweek 1 (fully confirmed) is unaffected — real, distinct
kickoff times still render correctly (`ISSUE-59`'s fix intact). Zero
console errors. `npm run build` clean; Deno 347/347 unchanged.
Responsive 375–1440px — zero overflow.

---

#### ISSUE-61 — `fullSyncInsert.js` wrote `deadline_utc` with zero offset at all
**Discovered and resolved 2026-08-19, Phase 19 (Pick Lock Deadline
Correction + Time Consistency Audit).** Found while auditing every
writer of `gameweeks.deadline_utc` before changing the ISSUE-24
offset conflict, not from a live symptom —
`frontend/scripts/fullSyncInsert.js` (the actual script that populated
this project's real Premier League data via football-data.org) wrote
`deadline_utc: kickoff` in its `upsertGameweeks()` — the earliest
kickoff time itself, with no subtraction of any kind. A fourth,
independent, and until now undiscovered implementation of the "when do
picks lock" rule, on top of the three ISSUE-24 already tracked.

**Why this hadn't caused visible drift**: the out-of-band DB trigger
`refresh_gameweek_deadlines()` (see `ISSUE-24`) fires `AFTER INSERT OR
UPDATE` on `fixtures` and this script's own `upsertFixtures()` always
writes to `fixtures` immediately after `upsertGameweeks()` — so the
trigger's own (previously 15-minute, undocumented) recomputation
silently overwrote this script's zero-offset value before anyone would
ever have read it. The bug was real but masked by another bug.

**Fixed**: added `minusFifteenMinutes()`, used at both write sites in
`upsertGameweeks()`, matching the new 15-minute business rule (see
`ISSUE-24`'s resolution). Not strictly load-bearing on its own now that
`refresh_gameweek_deadlines()` is the enforced single source of truth
(migration 029), but correct standalone regardless, per "don't leave a
value wrong even momentarily."

---

#### ISSUE-24 — An undocumented SQL trigger recomputes `gameweeks.deadline_utc` with a conflicting, incorrect offset — RESOLVED
**Originally discovered and confirmed live 2026-08-05**, during Milestone
4 Slice 6's live verification. `deadline_utc` kept reverting to a value
inconsistent with `compute-deadlines`' own formula immediately after any
change to a row in `fixtures`, with no Edge Function involved.
Root-caused via `information_schema.triggers`: `fixtures` has an `AFTER
INSERT OR UPDATE OR DELETE` trigger,
`trg_refresh_gameweek_deadlines_on_fixtures`, calling
`trigger_refresh_gameweek_deadlines()`, which calls
`refresh_gameweek_deadlines()` — a SQL function recomputing **every**
gameweek's `earliest_kickoff_utc`/`deadline_utc` from `fixtures`
directly, using `earliest_kickoff_utc - interval '15 minutes'`. This
conflicted with `compute-deadlines/index.ts`'s own formula (`earliest -
30 minutes`, matching the then-documented business rule) — whichever
mechanism ran most recently won, and since routine fixture syncs fire
the trigger constantly, the undocumented 15-minute value usually won in
practice. Neither object was tracked by any migration — created
directly against the live database at some point, `supabase_admin`-owned
(the same out-of-band pattern `ISSUE-1`/`ISSUE-21` document for other
objects).

**Resolved 2026-08-19, Phase 19 (Pick Lock Deadline Correction + Time
Consistency Audit)**, at the user's own explicit direction: rather than
just picking one of the two existing numbers, the business rule itself
was deliberately changed to **15 minutes before the gameweek's earliest
(non-postponed, non-cancelled) fixture kickoff** — "gameweek start" has
no dedicated field in this schema; it *is* this earliest-kickoff value,
confirmed by reading every writer of it, not assumed. The real fix was
architectural, not numeric: a full audit found **four** independent
implementations of this one rule, not the two this issue originally
tracked —
1. `compute-deadlines/index.ts` — 30 minutes (documented, but not what
   was actually live in practice)
2. This trigger's `refresh_gameweek_deadlines()` — 15 minutes,
   undocumented, and missing the postponed/cancelled exclusion
   `compute-deadlines` already had
3. `sync-fixtures/index.ts` (api-football, never successfully run in
   this environment) — 30 minutes
4. `frontend/scripts/fullSyncInsert.js` (the script that actually
   populated this project's real Premier League data) — **zero
   offset**, a genuine, separate, previously-undiscovered bug, tracked
   as its own issue (`ISSUE-61` above) rather than folded silently into
   this one, since it's a distinct root cause

Consolidated to exactly one authoritative writer:
`refresh_gameweek_deadlines()`, corrected to exclude postponed/cancelled
fixtures (matching `compute-deadlines`' own prior exclusion) and now
tracked by a real migration
(`supabase/migrations/029_deadline_single_source_of_truth.sql`) instead
of existing out-of-band. `compute-deadlines/index.ts` no longer computes
or writes `deadline_utc` at all — it now only reads the value this
trigger already maintains, to decide when to call each mode's
`lockEntries()`. `sync-fixtures/index.ts` and `fullSyncInsert.js` were
also corrected to write 15 minutes on their own initial insert (defense
in depth; the trigger is the real enforced last word either way).
`business-rules.md § When picks lock` rewritten to describe this
architecture and rule, its own "30-minute, not reliably enforced" caveat
removed since the conflict it described no longer exists.

**Verified live**: recomputed every existing real gameweek's
`deadline_utc` via the same corrected, legitimate function (not
manually fabricated) — confirmed exactly 15 minutes before
`earliest_kickoff_utc` for gameweeks 1-3 (`18:45:00` vs `19:00:00`).
Confirmed the trigger fires correctly on a live `UPDATE fixtures`.
Confirmed, in a rolled-back transaction, that marking the earliest
fixture `postponed` correctly shifts the deadline to the next-earliest
non-postponed fixture, then confirmed no lasting change after rollback.
Confirmed the same corrected value renders identically on the Dashboard
header, Dashboard sidebar, Score Predictor, and LMS — all four already
read the single `gameweeks.deadline_utc` column directly, with no
independent frontend calculation anywhere, so no frontend code changes
were needed for the value itself to be correct everywhere at once.

---

#### ISSUE-60 — Two real gameweek-state bugs found and fixed while building Dashboard gameweek navigation
**Discovered and resolved 2026-08-19, Phase 18 (Dashboard Gameweek
Navigation & Final UX Polish).** Two separate, real bugs found while
building the Dashboard's new Prev/Next gameweek navigation, both fixed
in the same change:

1. **`useAllGameweeks()` (`useGameweek.js`) had no league/season
   scoping.** The hook was defined but never called anywhere (confirmed
   by grep) — on this project's own database, calling it as originally
   written would have silently mixed the real Premier League's
   gameweeks with the dead FIFA World Cup reference league's gameweeks
   (both numbered 1-9+, genuinely ambiguous together once merged), the
   exact `ISSUE-52` class of bug `useCurrentGameweek()`/`useNextGameweek()`
   were already fixed for. Fixed by requiring an explicit
   `leagueId`/`seasonId` and filtering on both.
2. **`resolveGameweekState()`'s "locked" branch was gated on
   `currentGw &&`**, but `useCurrentGameweek()` (`is_current = true`)
   has never once returned a row on this project's own data
   (`ISSUE-39`) — so that gate was permanently false, meaning a
   gameweek whose deadline had genuinely passed could never actually
   render as "Locked" on the Dashboard; it fell through to "Upcoming"
   with a countdown target already in the past. Fixed by deriving
   locked status purely from the gameweek's own `deadline_utc`,
   independent of `is_current`, matching
   [business-rules.md's own deadline concept](./business-rules.md#when-picks-lock).

**Verified**: `resolveGameweekState()` unit-level logic re-read
line-by-line after the change; live-tested Prev/Next navigation across
gameweeks 1-2 (all currently "upcoming" — no fixture in the live
dataset has reached a locked/completed state yet to exercise those two
branches live, since the 2026/27 season hasn't started; verified by
code reading instead, not assumed).

**Also re-confirmed, not newly found**: `ISSUE-24` (the `deadline_utc`
15-min-vs-30-min trigger/Edge-Function conflict) is still present —
the Dashboard's new "Picks lock" display correctly shows whatever
`deadline_utc` actually holds at read time, per this phase's own
explicit "use the real deadline field, never infer it" requirement;
it does not paper over or fix `ISSUE-24` itself, which remains a
pre-existing, out-of-scope backend conflict.

---

#### ISSUE-59 — Every fixture in a Premier League gameweek showed an identical kickoff time on the Dashboard
**Reported and resolved 2026-08-18, Phase 16 (Hosted Beta Deployment +
Production Environment).** Reported live: the Dashboard's "Upcoming
fixtures" showed the exact same kickoff time (`Fri, 21 Aug, 20:00`) for
every fixture in Gameweek 1.

**Traced the full data path before assuming a layer**: confirmed via
direct SQL that `fixtures.kickoff_utc` itself held the identical
timestamp for all 10 rows in gameweeks 1/2/3/6/7/8/9 (while gameweeks
4/5 already had correctly varied times) — ruling out a frontend bug
immediately, since the database value itself was flat. Independently
confirmed `FixtureCard.jsx`/`Dashboard.jsx` correctly read
`fixture.kickoff_utc` (never `gameweek.deadline_utc`/`start_at`) in every
call site, and that `toLocalTimeShort()` (`utils/time.js`) does correct,
DST-aware UTC→`Europe/Dublin` conversion via `Intl.DateTimeFormat` — so
neither (B) frontend field selection nor (C) timezone handling was the
cause. Root cause: **(A) stale upstream reference data.**
`frontend/scripts/fullSyncInsert.js` (the real, existing football-data.org
ingestion script that originally populated league `6`'s data — confirmed
correct: it maps each match's own `utcDate` to `kickoff_utc` per-fixture,
not a shared value) had only been run once, at a point where the live
API had not yet published confirmed broadcast kickoff times for those
specific gameweeks — a real, normal characteristic of football-data.org's
own data (distant fixtures default to a placeholder time until TV picks
are announced). No cron job or recurring process re-runs this standalone
script (only the differently-provider'd `sync-fixtures` Edge Function,
using api-football, is cron-scheduled — and that one has never had a
working API key, per this document's own § 5).

**Fixed**: verified the configured `FOOTBALL_DATA_KEY` is live and valid
(a real `200` from `api.football-data.org`), confirmed the live API now
returns genuinely varied, current kickoff times for the near-term
gameweeks, then re-ran the existing `fullSyncInsert.js` script exactly as
designed — no code changes, no fabricated data, no second data source.
The script's `on_conflict=provider_id,provider_name` upsert updated the
existing 380 real fixtures/38 gameweeks/20 teams in place (DB counts
unchanged before/after, confirming no duplication). Gameweeks 1–9 now
show 6–7 distinct kickoff times each across their 10 fixtures, matching
a realistic Premier League broadcast schedule (Friday night, Saturday
12:30/15:00/17:30, Sunday, Monday). Gameweeks further out (10+) still
show a single placeholder time per gameweek — this is the real,
legitimate current state of the upstream API for fixtures whose TV picks
aren't confirmed yet, not a bug.

**Verified live**: Dashboard and the Score Predictor pot page (same
underlying `fixtures.kickoff_utc` data, different pages) both now render
7 distinct kickoff times for Gameweek 1's 10 fixtures, correctly
converted to `Europe/Dublin` local time. `deadline_utc` (a separate,
trigger-derived field — `MIN(fixture.kickoff_utc) − 15min` per gameweek)
was unaffected and remained correct throughout. Zero console errors.
`npm run build` clean; Deno suite 347/347 unchanged (no code changed,
data-only fix).

**Not fixed, out of scope, noted for awareness**: `fullSyncInsert.js`'s
`gwName()` helper returns `match.stage.replaceAll('_', ' ')`
("REGULAR SEASON") for every Premier League gameweek — `stage` is always
`"REGULAR_SEASON"` for league fixtures, so the `Matchday ${number}`
fallback branch is structurally unreachable for this competition. This
is pre-existing behavior (the same code ran at the original sync too,
not something this fix introduced) and only affects a secondary
dropdown label ("GW1 — REGULAR SEASON"), not the primary "Gameweek 1"
heading anywhere. Cosmetic, low-priority, not touched this phase per
its own "do not make unnecessary product/UX changes" scope.

**Recurring-sync gap flagged for beta**: since nothing currently
re-runs `fullSyncInsert.js` on a schedule, kickoff times for gameweeks
whose broadcast picks get confirmed later will go stale again after this
one-time fix unless either (a) this script is re-run periodically by an
operator, or (b) it's wired into a proper cron job before beta (out of
this phase's scope to decide unilaterally — flagged in `DEPLOYMENT.md`
as a recommendation, not applied).

---

#### ISSUE-58 — `useIsAdmin()` never accepted `super_admin` directly, locking the Super Admin out of `/admin` once they owned no pots
**Discovered and resolved 2026-08-18, Phase 15 (Beta Deployment
Preparation + Demo Data Cleanup).** Found live during this phase's own
Super Admin verification step, immediately after the approved demo-data
cleanup removed `benalexcre@gmail.com`'s three demo-linked pots:
navigating to `/admin` as the Super Admin returned "Not authorised."

**Root cause**: `useAdmin.js`'s `useIsAdmin()` (the hook `AdminRoute`
gates `/admin`, `/admin/payments`, `/admin/rollovers` with) checked
`role === 'app_admin'` only, falling back to "administers at least one
pot" for everyone else — it never accepted `super_admin` directly, unlike
the sibling `useIsAppAdmin()` hook two functions below it in the same
file, which already widens to `app_admin` OR `super_admin` "since Super
Admin inherits every app_admin capability," and unlike the real backend
boundary (`is_app_admin()`, the Postgres function backing RLS, confirmed
via `pg_get_functiondef` to already accept `('app_admin', 'super_admin')`).
The gap was invisible before this phase because `benalexcre@gmail.com`
always happened to also administer at least one pot (three demo-linked
ones), silently satisfying the fallback query — removing those pots as
part of this phase's approved cleanup was what exposed it.

**Fixed**: `useIsAdmin()`'s `isAppAdmin` check widened to
`role === 'app_admin' || role === 'super_admin'`, matching the exact
pattern `useIsAppAdmin()` already uses — not a new role concept, no
change to the real authorization boundary (`is_app_admin()`/RLS/Edge
Function checks were already correct; only the frontend route guard was
behind).

**Verified live**: reproduced the lockout with `benalexcre@gmail.com`'s
real session before the fix, confirmed `/admin` (including "Manual
jobs") loads correctly after it; re-confirmed `bentest5@gmail.com`
(`app_admin`) still sees `/admin` (payments/rollovers, not Manual
jobs/Demo Centre) and is still blocked from `/super-admin`;
`bentest6@gmail.com` (no elevated role) still blocked from both `/admin`
demo-only sections and `/super-admin`.

---

#### ISSUE-57 — Predictor entries with a non-`pending` status (e.g. `void`) disabled every score input with no explanation
**Discovered and resolved 2026-08-18, Phase 14 (Score Predictor UI Overhaul
+ Global UX Polish).** Found live while testing the redesigned Score
Predictor with a real test account: the score steppers and goalscorer
picker were greyed out with zero text anywhere on the page saying why.
Investigated the account's actual DB row before assuming a UI bug —
`game_entries.status = 'void'`, a real, legitimate business state (set by
a non-payment or an admin action), not a bug. `canPick = entry &&
entry.status === 'pending' && !deadlinePassed` in
`PredictorPotDetail.jsx` was already correct and unchanged. The gap was
purely explanatory: nothing told the viewer their entry was void or what
to do about it.

**Fixed**: `PredictorPotDetail.jsx` now shows "Your entry is currently
{status} — predictions are disabled until this is resolved. Contact the
pot organiser about your payment status." whenever `entry.status !==
'pending'` and the deadline hasn't passed. No change to payment logic,
entry status transitions, or the `canPick` gate itself — purely an
explanatory UI addition, matching the project's own established
"if something is disabled, explain why" precedent (`PlayerCard.jsx`'s
`disabledReason`, `LmsFixtureSelector.jsx`'s disabled-reason copy from
Phase 13).

**Verified live**: confirmed via direct SQL query that the test
account's entry was genuinely `void`, then confirmed the new notice
renders correctly for that account and does not render for a `pending`
entry.

---

#### ISSUE-56 — Dashboard read as visually misaligned against the top nav at wide viewports
**Discovered and resolved 2026-08-18, Phase 14 (Score Predictor UI
Overhaul + Global UX Polish).** Reported as "the Dashboard currently
appears visually misaligned" — investigated the actual layout rather than
guessing at one page's `max-width`. `AppShell.jsx`'s shared `<main>`
container (the one real content boundary every authenticated page renders
inside) was `max-w-6xl` (1152px), while `TopNav.jsx`'s own inner
container — directly above it, in the same visual column — has always
been `max-w-7xl` (1280px), a 128px mismatch. Confirmed via
`grep -rn "max-w-\[" src/pages/*.jsx src/components/pot/*.jsx` that
`Dashboard.jsx` additionally carried its own `max-w-[1400px] mx-auto`
override, and confirmed via CSS box-model reasoning that this override
was dead code: a child's `max-width` can never widen it past an
already-narrower parent, so it never actually bound anything.

**Fixed**: widened `AppShell.jsx`'s shared container from `max-w-6xl` to
`max-w-7xl` to match `TopNav.jsx`'s existing width (one shared boundary,
not a third competing number), updated `UnverifiedBanner.jsx` in the same
column to match, and removed `Dashboard.jsx`'s now-redundant dead
`max-w-[1400px]` override so it simply fills the shared container like
every other page.

**Verified live**: at 1440px, `TopNav`'s inner container and
`Dashboard`'s content container now share identical left/right pixel
bounds (measured via `getBoundingClientRect()`), confirmed zero
`scrollWidth`/`clientWidth` overflow at 375/390/768/1024/1440px across
both Dashboard and the Predictor page.

---

#### ISSUE-55 — Sign-in/sign-up/password-reset could hang silently on a network-level failure, with no error shown
**Discovered and resolved 2026-08-18, Phase 13 (Authentication
Reliability).** Reported live: `benalexcre@gmail.com` (a genuine
`super_admin` account) could not reliably sign in, with no error message
— the page appeared to just do nothing. Investigated the account first,
not the code: `auth.users` showed a confirmed email, no ban, a real
password hash, and the correct `super_admin` claim; GoTrue's own audit
log showed several fully successful `grant_type=password` 200 responses
for this exact account clustered within about 10 seconds of each other —
proving the credentials were correct the whole time, and that the user
was retrying because the app wasn't visibly completing sign-in, not
because they were guessing a wrong password. The same logs also showed a
**real, transient GoTrue↔Postgres connectivity failure** in this local
environment moments earlier (`"failed SASL auth: i/o timeout"`, then a
DNS resolution failure for the `supabase_db_pl-goals` hostname) — the
kind of infrastructure blip this investigation was built to survive, not
one this fix "solves" (it's outside the application's control).

**Root cause, confirmed by reading `@supabase/auth-js`'s own source**
(`node_modules/@supabase/auth-js/dist/main/lib/GoTrueClient.js`):
`signInWithPassword()` (and `signUp()`/`resetPasswordForEmail()`) only
catch and return `{ error }` for a structured `AuthError` (wrong
password, unconfirmed email, banned account, etc.) — any other exception,
including a genuine network/connectivity failure, is **rethrown**.
`SignIn.jsx`'s `handleSubmit` (and the equivalent handlers in
`SignUp.jsx`/`ForgotPassword.jsx`) had no `try/catch` around this call:
a rethrown exception was an unhandled promise rejection, so
`setLoading(false)` was never reached — the button stayed stuck on
"Signing in..." forever, with zero error shown. `useAuth.js`'s own
session-restoration `getSession()` call had the identical gap (its own
`__loadSession()` "may trigger a refresh," the exact kind of network call
that hit the confirmed connectivity blip): a failure there could leave
`ProtectedRoute`'s loading spinner spinning forever, or — if `getSession()`
resolved with `session: null` after an internal refresh failure — bounce
an already-successfully-authenticated user straight back to `/sign-in`
with no explanation, which is the more likely explanation for the
repeated login attempts actually observed in the logs.

**Fixed**: `try/catch/finally` added around the auth call in all three
forms (`SignIn.jsx`, `SignUp.jsx`, `ForgotPassword.jsx`) so `loading`
always resolves and a clear message is always shown; `useAuth.js`'s
`getSession()` gained a `.catch()` that fails safe to `user: null` (never
grants access on an error — fails closed, not open) instead of hanging.
New `utils/authErrors.js` maps GoTrue's machine-readable `error.code` to
human copy ("Incorrect email or password.", "Your email address has not
been verified yet...", "Your account has been suspended.") instead of
showing raw error text; a distinct, separately-confirmed failure shape
(`AuthRetryableFetchError`, `status: 0`, message `"Failed to fetch"` —
the request never got a response at all) is mapped to the same friendly
network-error copy. The underlying error is still `console.error`'d in
full for local debugging, never shown to the user verbatim.

**Verified live**: intercepted the real `/auth/v1/token` request via
Playwright and forced it to fail (`route.abort('failed')`) — confirmed
*before* this fix the button hung on "Signing in…" indefinitely with no
error (reproducing the reported symptom exactly), and *after* the fix it
shows "Unable to reach the server right now..." and re-enables
immediately. Re-verified the normal paths still work correctly against
the real backend: a genuinely wrong password shows "Incorrect email or
password."; a full sign-in via session injection (magic-link technique,
never the real password) confirmed session persistence across a browser
refresh and direct deep-route navigation; sign-out lands on `/`, not
`/sign-in`; a non-`super_admin` account is correctly blocked from
`/super-admin` (frontend guard) and still can't reach Manual Jobs
server-side (`sync-fixtures` re-tested: `super_admin` passes the auth
check, a plain pot-admin still gets a clean `401`) — no security
regression from Phase 8D/10B.

**Security implications**: none negative — the `.catch()` fallback in
`useAuth.js` fails to `user: null` (denies access) rather than assuming a
session is valid, so a transient error can never grant access it
shouldn't. No role system, RLS policy, or server-side check was touched;
Manual Jobs remains `super_admin`-only at both layers, re-confirmed live.

#### ISSUE-54 — Dashboard showed "Make your pick" to an already-eliminated LMS entrant
**Discovered and resolved 2026-08-18, Phase 12 (Dashboard 2.0 + Global
Product UX Polish).** Found live testing a real (non-demo) account whose
only entry in its own LMS pot was already `competitive_status =
'eliminated'`. `getPotAction()`/the "Your next pick" summary card only
ever checked `hasEntry`/`pickSubmitted`, neither of which knows the
entrant is out — `LmsPotDetail.jsx`'s own `canPick` already excludes
eliminated entrants from picking at all, but the Dashboard's own CTA
logic had no equivalent check, so it prompted a player who business rules
(`business-rules.md` § Last Man Standing, "Elimination") already forbid
from picking again. **Fixed** by threading the viewer's own
`game_entry_lms.competitive_status` through `useDashboardPotStatus()`
(`lmsEliminated`) and checking it before offering a pick CTA — an
eliminated entrant's competition card now reads "Eliminated" and they're
never selected as the homepage's "next pick needed" pot. No business
logic changed — this is a read-only Dashboard presentation fix.

#### ISSUE-53 — `useDashboardPotStatus` read another pot member's entry/payment as the viewer's own
**Discovered and resolved 2026-08-18, Phase 11 (Dashboard rebuild),
formally logged Phase 12.** `entry_payments`/`game_entries` are
intentionally readable pot-member-wide (the payment/pick-reveal features
every pot's own page already relies on), but this hook's batched queries
had no `user_id` filter at all — only `pot_id`. On any pot with more than
one member, `.find()` could silently match a **different member's** row.
Confirmed live: a 51-member demo pot the viewer had never personally
entered still showed "Completed," sourced from another member's
season-scoped entry. **Fixed** by scoping both queries to
`user_id = <signed-in user>` — a missing filter, not an RLS gap (RLS
already correctly permits the pot-wide read for the surfaces that
legitimately need it). Re-verified live: the same account now correctly
shows "Start playing" for that pot.

#### ISSUE-52 — Dashboard's "next gameweek" query had no league filter, surfacing "FIFA World Cup" instead of Premier League
**Discovered and resolved 2026-08-18, Phase 11 (Dashboard rebuild),
formally logged Phase 12.** `leagues` is reference data that has
accumulated a retired `api-football`-provider Premier League row, a
genuinely unrelated "FIFA World Cup" row, two Demo Centre leagues, and the
one real, currently-used Premier League row — confirmed live via direct
query. `useNextGameweek()`'s "soonest non-completed deadline" query had no
league filter whatsoever, and the World Cup's own (demo-seeded) gameweeks
sort earlier (June 2026) than the real Premier League's (August 2026), so
it always won. **Fixed** by scoping both `useCurrentGameweek()` and
`useNextGameweek()` to `leagues.is_active = true` (already `false` on both
the retired PL row and the World Cup row) and
`leagues.provider_name != 'demo'` (the exact identifier
`_shared/demo/teardown.ts` already uses to find demo reference data) —
reusing existing reference-data semantics, never a hard-coded league name.
Verified live directly against PostgREST: the query now returns
`league_id=6, "Premier League"`.

#### ISSUE-51 — `_shared/adminOrCronAuth.ts` rejected `super_admin`, accepting only the literal string `'app_admin'`
**Discovered and resolved 2026-08-18, Phase 10B (LMS UX + Global Product
Polish).** Found while deliberately narrowing Manual Jobs
(`compute-deadlines`/`compute-scores`/`settle-gameweek`/`sync-fixtures`)
from `app_admin` to `super_admin`-only, per the user's own explicit
instruction (Manual Jobs triggers platform-wide sync/scoring/settlement,
reserved for platform ownership — the same reasoning already applied to
Demo Centre in Phase 8D). Reading the existing check before changing it
(`isAuthorizedAdminOrCron()`'s final line,
`data.user.app_metadata?.role === 'app_admin'`) revealed this was already
narrower than intended: a `super_admin` — who is supposed to inherit every
`app_admin` capability, per Phase 8D's own stated hierarchy — was being
silently **rejected** by this exact check the whole time, despite
`AdminDashboard.jsx`'s frontend gate (`useIsAppAdmin()`, which does accept
`super_admin`) showing them the Manual Jobs buttons. A real, confirmed,
pre-existing authorization bug, not theoretical: any `super_admin`
clicking Manual Jobs got a `401 Unauthorized` from the Edge Function.
**Fixed** by the same edit this phase's own deliberate narrowing already
required — changing the check to `role === 'super_admin'` closes both the
narrowing and the mismatch at once. **Verified live** via a full HTTP
matrix against `sync-fixtures` with real tokens: anon key → `401`; a plain
signed-in user → `401`; a real `app_admin` account → `401` (confirms the
deliberate narrowing); a real `super_admin` account → passed the auth
check (reached the function's own downstream parameter validation, not
the `401` gate); the platform's own cron service-role key → also passed
the auth check the same way. `AdminDashboard.jsx`'s frontend gate was
switched from `useIsAppAdmin()` to the stricter `useIsSuperAdmin()` in the
same change, confirmed live: a plain `app_admin` test account no longer
sees the Manual Jobs section at all, only Payment verification/Rollover
management.

#### ISSUE-50 — `TopNav.jsx`'s "Sign out" button overflows the viewport at 768px for a `super_admin` account
**Discovered 2026-08-18, Phase 9 (Demo Gameweek verification)**, while running
the standard 375/390/768/1440px responsive sweep — confirmed live via direct
`getBoundingClientRect()` measurement, not eyeballed: at exactly 768px,
signed in as the real `super_admin` account (five nav links visible —
Dashboard/Pots/Profile/Admin/Super Admin, one more than a plain `app_admin`
or pot admin ever sees), the "Sign out" button's right edge sits at 793px
against a 768px viewport (`document.documentElement.scrollWidth` 793 vs
`clientWidth` 763) — a real ~25px horizontal overflow, reproduced twice,
confirmed absent for the same account/breakpoint once fewer nav links are
present. Initially misattributed to the Demo Gameweek page's own new pot
cards (that page was open when first found) — re-verified on the plain
`/dashboard` page with zero demo content once the actual cause was
narrowed down via `getBoundingClientRect()`, confirming this is a
`TopNav.jsx` layout issue, not anything in that phase's own new code.
Distinct from Phase 8D's own `TopNav.jsx` fix (the profile-info block's
`min-w-0`/`truncate`) — that fix's own verification pass evidently never
happened to test 768px with all five super_admin-only nav links visible at
once. **Resolved 2026-08-18, Phase 10B**: the nav link row itself
(`<nav>` in `TopNav.jsx`) is now `min-w-0 overflow-x-auto` with each
`NavLink` set to `shrink-0` and slightly tighter padding/gap below the
`lg` breakpoint, instead of relying on the nav row refusing to shrink.
Re-verified live at 375/390/768/1440px on the real `super_admin` account
(all five nav links visible): zero horizontal overflow at every
breakpoint, confirmed via `document.documentElement.scrollWidth` vs
`clientWidth`.

#### ISSUE-49 — `FixtureCard.jsx`'s team row had no width constraint, overflowing with longer names or a full form history
**Discovered and resolved 2026-08-18, Phase 9 (Demo Gameweek verification).**
Found via the standard 375px `scrollWidth`/`clientWidth` check on the new
Demo Gameweek page — `TeamRow`'s root `<div>` (inside `FixtureCard.jsx`,
shared across Dashboard/GameweekPage/every picker) had `flex items-center
gap-2.5` with no `min-w-0`/`flex-1`, so as a flex item it defaulted to
`min-width: auto` (its content's natural width) and refused to shrink —
harmless with the short real club names and 0-2 completed-fixture form
rows every prior manual check happened to use, but a real, confirmed
overflow once a team has a full 3-5-result form row (`TeamForm.jsx` shows
up to 5 W/D/L badges) and a longer generated demo club name. Confirmed
live: 397px content in a 370px viewport. **Fixed** by adding
`min-w-0 flex-1` to `TeamRow`'s root and `min-w-0 overflow-hidden` to its
form-badge row, so the browser truncates the team name and clips the form
row gracefully instead of forcing the whole page wider — same fix shape
as `AppShell.jsx`/`TopNav.jsx`'s own Phase 8D overflow fixes. Re-verified
at 375/390/768/1440px afterward: zero overflow, team names truncate with
an ellipsis when genuinely too long, form badges clip cleanly.

#### ISSUE-48 — Demo league team generation could give two different teams the identical `short_name`
**Discovered and resolved 2026-08-18, Phase 9 (Demo Gameweek verification).**
`randomClubName()` (`supabase/functions/_shared/demo/names.ts`) deduped
candidate teams on the *full* `"${place} ${noun}"` name only (e.g. "Ashford
Villa" vs "Ashford Town" are distinct full names) — but `shortName` was
just `place` alone, never separately checked for uniqueness. Confirmed
live: a real demo league generated both "Ashford Villa" and "Ashford Town"
with identical `short_name: "Ashford"`; every consumer that renders
`short_name` (`FixtureCard`, `MatchCentreDrawer`, standings, every picker)
would show two visually identical, indistinguishable teams — "Kingswell
vs Kingswell" was the literal fixture-card text seen live. Also produced a
React duplicate-key warning in this phase's own new `DemoFixtureInsight.jsx`
(a symptom, not the root cause). **Fixed** by deduping on the `place`
itself (`CLUB_PLACES` has 10 entries, `TEAM_COUNT` is 8 — always enough
headroom), which guarantees both `shortName` uniqueness and full-name
uniqueness as a side effect. Re-verified live: a fresh demo league's 8
teams all have distinct `short_name` values, confirmed via direct query.

#### ISSUE-47 — Every synthetic demo LMS user picked the identical team every gameweek
**Discovered and resolved 2026-08-18, Phase 9 (Demo Gameweek verification).**
`writeLmsPicksBatch()` (`supabase/functions/_shared/demo/generateHistory.ts`)
chose each synthetic user's team via
`teamsInPlay.find((t) => !usedTeamIds.has(t))` — the *first* unused team in
a fixed order every user in the batch shares (the same
`league.fixturesByGameweek` object), so with an empty `usedTeamIds` set at
the start of every user's loop, all of them landed on the same first team
in gameweek 1, the same second team in gameweek 2, and so on. Confirmed
live: 10/10 demo LMS users on one team in GW1, the same 10 on a second
team in GW2 — the exact "every user choosing the same team" failure this
generator's own Part 20 requirement explicitly warns against. **Fixed**
by picking uniformly at random among the still-unused candidate teams
(`availableTeams[Math.floor(rng() * availableTeams.length)]`, the same
already-seeded `rng`, so still fully reproducible for a given seed) instead
of always taking the first one. Re-verified live: a fresh demo league
shows a real, varied per-gameweek team distribution across users (e.g. one
gameweek split 1/1/3/3/1/1 across six different teams, not 10/0/0/0/0/0).
Surfaced a related, real product characteristic (not a bug — see the
Phase 9 session-log entry): with only 10 demo users and 2 history rounds
already settled by the time the live gameweek is reached, LMS survival to
that point is genuinely down to chance and can reach zero survivors,
leaving nothing for a live walkthrough to demonstrate — generating with
25+ users markedly reduces this risk.

#### ISSUE-46 — Pick 5 entry save threw a dead-reference error after every successful save
**Discovered and resolved 2026-08-18, Phase 9D (Pick 5 review pass).** Found
while reading `PotDetail.jsx`'s `handleSaveEntry()` during 9D's light-touch
review, not by reproducing a user report first — `setShowPicker(false)` was
called right after a successful `submit-pick5-picks` call, but no
`showPicker`/`setShowPicker` state was ever declared anywhere in the file
(confirmed via a full-file grep). Every successful save threw a
`ReferenceError`, caught by the surrounding `try`/`catch`, which then
overwrote the just-shown "Picks saved successfully" toast with a second,
confusing "setShowPicker is not defined" error toast — the picks themselves
still saved correctly (the write had already completed before the
dead reference was reached), only the UI feedback was wrong. **Fix:** deleted
the dead call — no `showPicker` UI element exists anywhere in this file, so
there was nothing to actually toggle. Live-verified: signed in as a real
pot admin (`bentest6@gmail.com`), selected 5 players in a real Pick 5 pot,
saved, confirmed zero console errors and the "Picks submitted" status chip
updating correctly with no stray error toast. Test entry removed by exact
ID afterward (`game_entries` row + its 5 `pick5_picks` rows); the pot's
pre-existing `entry_payments` row was left untouched.

#### ISSUE-45 — `.env.example` documented the wrong variable names for the football API integration and omitted `SUPABASE_ANON_KEY`
**Discovered and resolved 2026-08-10, Production Readiness Sprint (Staging &
Deployment Audit).** Verified, not assumed: grepped every `Deno.env.get(...)`
call across `supabase/functions/` and every `import.meta.env.VITE_*` call
across `frontend/src/`, then diffed the result against `.env.example`.
`.env.example` (and this project's own `.env`/`frontend/.env.local`, which
mirror it) documented `FOOTBALL_DATA_KEY`, `FOOTBALL_COMPETITION_CODE`, and
`FOOTBALL_SEASON` — **no code anywhere reads any of these three names.**
`sync-fixtures/index.ts` actually reads `VITE_FOOTBALL_DATA_KEY` (confirmed
line 28 — the `VITE_` prefix is a naming holdover from an earlier design,
not a typo to silently "correct," since renaming it would be a code change
out of this sprint's scope) and `COMPETITION_ID` (a numeric api-football
league ID, falling back to the request body's `competitionId`, then to the
literal default `'WC'`). Separately, `.env.example` never listed
`SUPABASE_ANON_KEY` at all, despite seven Edge Functions requiring it
(`admin-actions`, all three `get-or-create-*-entry` functions, all three
`submit-*-pick*` functions, and — via `_shared/adminOrCronAuth.ts` — the
four `ISSUE-26`-gated functions' own human-app-admin auth path). **Impact,
confirmed live**: this project's own local environment has never had a
working `sync-fixtures` API key as a result — `sync_runs` shows repeated
`failed`, `0 processed` entries for this job, matching exactly what a
missing/misnamed key would produce. **Fixed** by correcting `.env.example`
to the verified-correct variable names, with an inline comment explaining
the `VITE_` naming holdover so a future reader doesn't "fix" it into
something the code no longer reads. **Not fixed**: this project's own local
`sync-fixtures` still has no real API key configured — that requires a real,
paid third-party credential outside this session's reach; flagged clearly in
[DEPLOYMENT.md § 5](./DEPLOYMENT.md#5-secrets-and-environment-variables) as
a required step for any real deployment rather than silently left
undiscoverable.

#### ISSUE-40 — Every cron-triggered call to `compute-deadlines`/`compute-scores`/`settle-gameweek`/`sync-fixtures` silently failed with 401
**Discovered and resolved 2026-08-10, Launch Readiness Sprint 2 (End-to-End
Workflow Audit).** The local database's `app.settings.service_role_key` GUC
(read by every HTTP-calling cron job — `003_cron_jobs.sql`/
`006_fix_cron_job_headers.sql`) held the new-format `sb_secret_...` key,
while the Edge Runtime container's actual `SUPABASE_SERVICE_ROLE_KEY` env
var — the value `_shared/adminOrCronAuth.ts` (`ISSUE-26`'s own fix) compares
against — held the legacy `eyJhbGc...` JWT key. Two different values for
what both systems assume is the same credential. Every real cron tick's
`net.http_post()` call reached the function and was rejected with a `401`,
while `cron.job_run_details` still reported `succeeded` (it only reflects
whether the SQL statement/async enqueue itself errored, not the downstream
HTTP response — the exact distinction the `/health` skill's own guidance
warns about). Confirmed, not assumed: `cron.job_run_details` showed
`succeeded` throughout, but `net._http_response` for the same window showed
real `401`s (18 of them) alongside the already-known `404`s from `ISSUE-4`'s
missing `sync-live-events` function — and a direct call reproducing cron's
exact request (same URL, same header shape, the literal `sb_secret_...`
value) returned `401` on demand. This has been silently breaking the entire
automated pipeline — locking, scoring, settlement, fixture sync — for every
real scheduled run since `ISSUE-26`'s fix shipped (Launch Readiness Sprint
1A, 2026-08-10), not just this session's test data. **Fixed** by correcting
the live GUC (`ALTER DATABASE postgres SET app.settings.service_role_key =
'<the Edge Runtime's actual key>'`, run as `supabase_admin` — `postgres`
itself lacks permission to set this custom GUC, the same ownership split
`ISSUE-21` already documents) to match the Edge Runtime's real credential.
Not migration-tracked, deliberately — this GUC holds a secret, and the
existing cron migrations already read it via `current_setting()` rather
than hard-coding it for exactly that reason; the correct value is
environment-specific configuration, not something a versioned migration
should encode. **Live-verified after the fix**: a fresh-session replay of
the exact cron SQL returned `200`; a real, unmodified `compute-scores-
every-3-min` tick (observed live, not manually triggered) returned `200`
with a normal `gameEngineDispatches` count. **This fix applies only to this
local development database** — any deployed/hosted Supabase project has its
own separate `app.settings.service_role_key` GUC that must be checked and,
if it shows the same key-format mismatch, corrected the same way before
relying on its cron pipeline. No code changed — this was a configuration
fix, not an application bug.

#### ISSUE-3 — `player_fixture_goals` materialized view is never refreshed
**Discovered** at initial documentation, status left as "unverified" ever
since. **Confirmed live and resolved 2026-08-10, Launch Readiness Sprint 2.**
`compute-scores` reads live goal counts from the `player_fixture_goals`
materialized view; nothing anywhere in the repository ever called
`select public.refresh_player_fixture_goals()`. Confirmed, not assumed: the
view held exactly 0 rows even after real goal events existed in
`fixture_events` for a finished fixture, and a grep across the entire
`supabase/` tree found the refresh function defined in
`001_initial_schema.sql` and never once invoked. Every mode's
`calculateScore()` (Pick 5 directly, LMS's/Predictor's own goal-dependent
paths) silently computed against permanently-zero goal counts — a real,
launch-blocking scoring bug, not a hypothetical one. **Fixed** with the
smallest possible change: `compute-scores/index.ts` now calls
`sb.rpc('refresh_player_fixture_goals')` once at the start of every run,
before either the retired-prototype scoring loop or any `GameEngine.
calculateScore()` reads the view — no schema change, no new cron job, the
existing 3-minute cadence is what keeps it fresh. Live-verified: seeded a
real goal event for a real finished fixture, ran `compute-scores`, confirmed
`player_fixture_goals` now had rows and the corresponding Pick 5 picks
correctly resolved to `won`/`goals_scored`. See
[decisions.md § Launch Readiness Sprint 2](./decisions.md#launch-readiness-sprint-2--end-to-end-workflow-audit).

#### ISSUE-43 — "Your pots" showed every pot with 2+ members once per fellow member
**Discovered and resolved 2026-08-10, Launch Readiness Sprint 2.**
`potManager.jsx`'s `loadPots()` queried `pot_members` with no `user_id`
filter, relying solely on RLS to scope the results. `pot_members`'s own
SELECT policy is `is_pot_member(pot_id)` — correct for the Members list
elsewhere (any member can see every row for a shared pot) — so for any pot
with two or more members, this query returned one row per member, each
carrying the same joined `pots(...)` object. React's own duplicate-key
warning surfaced it directly (`Encountered two children with the same key`)
the first time this session tested a genuinely 2-member pot — every pot
with more than one member was silently affected before this fix, not just
the one that surfaced it; single-member pots never triggered it, which is
likely why it went unnoticed through every prior session's own live
verification (each of which used single-member or same-viewer-only test
pots). **Fixed** by adding `.eq('user_id', user.id)` to the query
(`useAuthStore()`, already the established pattern elsewhere in this
codebase). Live-verified: a real 2-member pot's card appeared exactly once
in "Your pots" after the fix, zero console errors, pot count correct.

#### ISSUE-8 — No self-serve pot-join flow
**Discovered** (join-flow half) at initial documentation; **extended
2026-08-09** during the Phase 7 Stage 1 audit to also cover `remove_member`
(identical no-UI gap, plus a stale cross-reference correction — `MemberTable.jsx`
is simply orphaned/dead code, not blocked on the by-then-resolved `ISSUE-6`).
**Resolved 2026-08-09**, Phase 7 Stage 2 Slice 3. Both `pots.invite_code`/
`redeem_invite()` (self-serve join by code/link) and `admin-actions`'
`add_member`/`remove_member` (organiser adds/removes a known user directly)
are now reachable through the UI — a new public `/join`/`/join/:inviteCode`
route, a new `InviteCard` (copy code/link, generate-if-missing,
add-by-username) and `MemberList` (plain list + admin-only remove with a
confirmation dialog) mounted on all three pot-detail surfaces. Zero backend
changes — every capability used was already implemented and tested; see
[decisions.md § Member invitations](./decisions.md#member-invitations) for
the full account, including the repo owner's explicit decision to keep
membership immediate rather than add a pending-invitation layer (`redeem_invite()`'s
own deferred `max_members`/`status` checks, `schema-review.md #5`, remain
genuinely deferred to Milestone 7 — unrelated to and unblocked by this
resolution). **Not resolved, deliberately out of scope**: a member cannot
remove themselves ("leave") — `admin-actions`' `remove_member` is
authorization-gated to pot admins only; extending that gate was judged new
backend business logic, not a bug fix, so it wasn't built. Verified live
with two real users (organiser + player, sequential sessions): invite
generation, join by link, join by code, duplicate-join protection,
add-by-username, remove, rejoin, invalid-code handling, and the
signed-out-visitor redirect-preserving sign-in flow. All test data (1 pot,
2 users) removed by exact ID, independently re-verified as zero residue.

#### ISSUE-33 — Last Man Standing and Score Predictor have zero frontend integration
**Discovered 2026-08-09** during the Phase 7 Stage 1 audit; **player experience
resolved 2026-08-09**, Phase 7 Stage 2 Slice 2. Both modes are fully
implemented, unit-tested, and live-verified on the backend (all eight
`GameEngine` methods each), but no frontend code referenced either mode at
all — confirmed by an exhaustive grep of every LMS/Predictor-related term
and `game_type` itself returning zero matches anywhere in `frontend/src`.

**Fixed**: `pages/PotDetail.jsx` now branches on `pot.game_type` immediately
after the pot loads, dispatching to two new, fully separate components
(`components/pot/LmsPotDetail.jsx`, `components/pot/PredictorPotDetail.jsx`)
rather than being crammed into the already-large, Pick5-only body — mirrors
the backend's own per-mode separation (GE-18) at the frontend layer.
New hooks (`hooks/useLmsEntry.js`, `hooks/usePredictorEntry.js`) wrap the
already-implemented, already-tested `get-or-create-lms-entry`/`submit-lms-pick`/
`get-or-create-predictor-entry`/`submit-predictor-picks` Edge Functions —
no backend logic duplicated, no new business rules invented. Both new
components implement every journey item live-verified through the real
browser: join, view entry, submit pick/prediction, edit before deadline,
view locked pick/prediction, view previously-used-teams (LMS) or cumulative
score (Predictor), view elimination status (LMS), view standings.
`components/leaderboard/LeaderboardTable.jsx` gained a `gameType` prop (default
`'pick5'`, so the one existing call site needs no change) so standings render
correctly for all three modes instead of always assuming a `score/5` shape —
LMS shows alive/eliminated (from `meta.competitiveStatus`/`eliminatedGameweekId`,
exactly matching `LmsEngine.generateStandings()`'s own written shape),
Predictor shows cumulative points plus `meta.exactScoreCount`/`correctScorerCount`.
The LMS team-picker and Predictor fixture/goalscorer pickers only ever offer
choices the server will actually accept (mirrors each engine's own
`validateEntry()` checks directly, read from source, not guessed) — teams
with a fixture in the selected gameweek, previously-used teams disabled,
goalscorer candidates restricted to the two teams in the selected fixture.

**Deliberately not built this slice** (out of the explicit player-journey
scope, and each is its own real, separate gap): member invite/add — see
`ISSUE-8`, still the reason a second real player cannot join a pot through
the UI at all today, so this slice's live verification could only exercise
a single (admin/creator) player's full journey per mode, not a genuine
multi-player competition; season-scoped payment admin UI — `ISSUE-35`;
`reinstate_entry` UI — `ISSUE-36`. `GameweekPage.jsx`'s own "Entries" section
still only renders Pick 5 shape (degrades to an empty section for LMS/
Predictor rather than crashing, confirmed) — not extended this slice, since
each new pot-home page already satisfies "view locked pick" on its own;
flagged as a possible future enhancement, not a gap in the stated journeys.

**Minor cosmetic gap found, not fixed**: `LeaderboardTable`'s LMS elimination
subtitle reads `meta.eliminatedGameweekId` directly, which is a raw
`gameweeks.id`, not the human-readable gameweek number the rest of the UI
shows (`LmsPotDetail.jsx` itself resolves this correctly via its own loaded
gameweeks list). `LeaderboardTable` has no gameweek-number lookup available
to it (used from both the pot-home pages and `GameweekPage.jsx`, neither of
which currently passes one down) — fixing it cleanly needs a small prop
threaded through both call sites, left as a documented, low-priority,
purely-cosmetic follow-up rather than expanding this slice's scope.

**Backend bug found and fixed during this slice's own live verification —
see `ISSUE-28`'s update** for the full account: two undocumented, out-of-band
`pots` INSERT policies (already known, previously classified harmless
duplicates) turned out to actively bypass the new active-league RLS check
this same slice added, until dropped.

#### ISSUE-34 — Pot creation form exposes only 2 of ~20 configurable pot-contract columns
**Discovered 2026-08-09** during the Phase 7 Stage 1 audit; **resolved the same
day**, Phase 7 Stage 2's first slice. `components/pot/potManager.jsx`
(`handleCreatePot`, the only organiser-facing pot-creation flow) inserted into
`pots` with exactly `{ name, season_id, league_id, status: 'active', created_by }`
— five columns, of which only `name` and the league selector were genuinely
organiser choices. Every other configurable column (`game_type`, `entry_fee`,
`end_gameweek_id`/`start_gameweek_id`, `admin_fee_*`/`charity_fee_*`,
`predictor_cycle_mode`/`predictor_scorer_scope`/the three Predictor scoring
point columns, `wipeout_resolution`, `season_end_tie_rule`, `max_members`,
`description`) was DB-default-only, with no UI — the direct cause of `ISSUE-33`,
since an organiser could not create anything but a free, default-scoring Pick 5
pot.

**Fixed**: `components/pot/potManager.jsx`'s create-pot form rebuilt with the
full pot-contract field set, sectioned as Basics / Game mode / Entry & Prize /
mode-specific settings (LMS or Predictor, conditionally rendered on the
selected `game_type` — Pick 5 needs no extra section). `hooks/usePots.js`'s
previously-unused `useCreatePot` mutation was extended to accept the full
config and do the two-step insert (`pots` then the admin `pot_members` row) —
reused rather than duplicated, and no longer dead code (see `ISSUE-11`'s own
note, corrected accordingly). Client-side validation matches the DB's own
constraints exactly, no stricter (fee type/amount consistency per
`pots_admin_fee_consistency`/`pots_charity_fee_consistency`; non-negative
Predictor point values per their own `>= 0` check constraints) — no new rule
invented beyond what the schema already enforces. `season_end_tie_rule`'s
`final_prediction` option is shown but disabled (`LmsEngine.awardPrize()`
still deliberately throws `LmsFinalPredictionNotImplementedError` for it — see
[decisions.md § LMS prize awarding](./decisions.md#lms-prize-awarding)), so
the UI can't set up a pot for a guaranteed future failure. `end_gameweek_id` is
required for both LMS and Predictor (the only season-conclusion mechanism
either engine's `determineWinner()` has — confirmed by reading both engines'
`classifyOutcome()` directly: a null value returns `{ type: 'in_progress' }`
forever, not an error, so an organiser who skipped it would have no way to
notice *or* fix it later, since no pot-edit UI exists yet); `start_gameweek_id`
is required for LMS specifically, since `get-or-create-lms-entry`'s
`checkEntryWindow()` (`ISSUE-32`'s own fix) rejects every entry attempt for a
normal pot with no `start_gameweek_id` set — leaving it blank would make an
LMS pot literally unjoinable. Dashboard.jsx and `potManager.jsx`'s own pot list
now display the pot's game mode. No backend/schema changes — every column
used, its check constraints, and its client-INSERT grant already existed (see
`013_lms_wipeout_and_rollover.sql`/`019_predictor_scoring_config.sql`).

**Verified live** through the real browser UI (Playwright, real local
Supabase): created a Score Predictor pot (all Predictor-specific fields:
cycle mode, scorer scope, three point values, end gameweek) and a Last Man
Standing pot (start/end gameweek, wipeout resolution, season-end tie rule,
percentage admin fee + fixed charity fee, confirming the fee-type
mutual-exclusivity logic) — both correctly persisted, confirmed by direct
`pots` table read post-creation; submitting without a required end-gameweek
selection was correctly blocked client-side with a clear message; game-mode
badges rendered correctly in the pot list. All test data (2 pots, 1 auth user,
1 profile) removed by exact ID, independently re-verified as zero residue.

**Found, not fixed, while live-verifying this fix**: the seed data's
"current" league/season has zero gameweeks — see `ISSUE-39`, a genuinely
separate, pre-existing data problem this slice's live verification happened
to surface, not something this fix introduced or could fix itself.

#### ISSUE-32 — `get-or-create-lms-entry` has no entry-window gate
**Discovered and resolved 2026-08-05.** `supabase/functions/get-or-create-lms-entry/index.ts`
(Milestone 5 Slice 1, committed `2db86b4`) checked pot membership and
`game_type` only — it would create an LMS entry at any time, for any pot,
regardless of whether the competition had started. Reasonable when Slice 1
was built (no entry-window rule existed yet for LMS); invalid once the
Wipeout Resolution/rollover/late-entry decisions landed — see
[decisions.md § LMS: Wipeout Resolution, automatic rollover, and a fixed per-competition entry fee](./decisions.md#lms-wipeout-resolution-automatic-rollover-and-a-fixed-per-competition-entry-fee).
**Fixed**: a new pure `checkEntryWindow()` (`validate.ts`) checked before pot
membership — a normal pot rejects once `now() >= start_gameweek's
earliest_kickoff_utc` (one-time cutoff, boundary exclusive); a rollover pot
(`rollover_source_pot_id` set) is allowed only while `status = 'draft'`,
regardless of gameweek timing; a normal pot with no `start_gameweek_id`
configured is rejected rather than silently allowed. 6 new unit tests.
**Verified live** through the real Edge Function (not a DB-only check): 5
scenarios covering both pot types and the boundary/misconfiguration cases,
all passing, using real gameweeks (`id=1`, kickoff 2026-06-11, past; `id=28`,
kickoff 2026-08-21, future). All test data (pots, pot_members, game_entries,
one auth user) removed by exact ID — caught and fixed a real bug in the
*verification script itself* along the way: cleanup initially deleted
parent pots before the rollover pots referencing them via
`rollover_source_pot_id ... on delete restrict`, so several deletes failed
silently (no error check on the cleanup calls) and left 10 test pots + 3
test users behind; corrected by deleting dependents (rollover pots, and
their `game_entries` rows) before their sources, then re-verified zero rows
remained matching the test's naming pattern. Also surfaced a **local-dev
infrastructure issue, not a product bug**: `docker restart
supabase_edge_runtime_pl-goals` gives that container a new internal Docker
IP, but Kong caches the old one and returns 502 ("Host is unreachable") for
every function call — not just the newly-edited one — until Kong itself is
also restarted. Different symptom from the earlier-documented "new function
directory needs a full `supabase stop`/`start`" note (session-log entry 26)
but same category: restarting only the edge runtime container is not
sufficient after any change, a Kong restart is also needed. Worth
remembering for the next slice that edits an existing function.

#### ISSUE-6 — Payment Verification has no UI or bulk import; `compute-scores`/`settle` will void every entry
**Resolved 2026-08-05.** A pot admin (or app admin) can now verify payments, both
manually and via CSV, through `/admin/payments` (`pages/AdminPayments.jsx`) —
see [business-rules.md § Payment verification rules](./business-rules.md#payment-verification-rules)
for the full user-facing behavior and the two disclosed limitations (per-row, not
batch-level, audit trail; row-level partial-failure reporting within one confirmed
import). Backend: `admin-actions` gained one new action, `bulk_verify_payments`
(dry-run preview + apply, same shape either way — `supabase/functions/admin-actions/
bulkPayments.ts`, 18 unit tests). **No schema changes were required** — see
[decisions.md § Payment Verification bulk import: no schema change needed](./decisions.md#payment-verification-bulk-import-no-schema-change-needed)
for why: `entry_payments` already had every column needed, and identifier (email/
phone) resolution — the one capability that genuinely didn't exist anywhere in the
codebase — is reachable via the service-role client's existing GoTrue Admin API
(`auth.admin.listUsers()`), not a new SQL function or view. A real bug was found and
fixed during live verification: GoTrue stores phone numbers without their leading
`+` (E.164 in, digits-only out, confirmed live) — phone matching now strips a
leading `+` from the CSV identifier before comparing. Verified live, end-to-end,
through the real application: manual paid/unpaid, CSV import (valid rows, duplicate
identifiers, unknown users — both an unregistered email and a phone number in the
wrong format — unknown pots, an invalid status value, rows already in their target
state), and settlement correctly respecting a payment verified via CSV (an entry
that would otherwise void settled and won its pot once its CSV row was applied).
The `trg_create_entry_payment`-not-attached-to-`game_entries` gap this issue's entry
previously extended to remains accurate and unfixed (still true, still non-blocking
for the reasons already recorded) — not this issue's concern to close, since
`admin-actions`' `mark_paid`/`bulk_verify_payments` never depended on that trigger's
placeholder row existing first.

#### ISSUE-29 — `supabase_realtime` publication had zero tables registered; every realtime subscription was silently non-functional
**Discovered and resolved 2026-08-05**, during the production hardening sprint
audit. `select * from pg_publication_tables where pubname = 'supabase_realtime'`
returned zero rows live, and `pg_publication.puballtables = false` — meaning
`frontend/src/hooks/useLiveScores.js`'s four `postgres_changes` subscriptions
(`fixtures`, `fixture_events`, `fixture_player_status`, `pick5_picks`) never
received a single change event, ever, with no error raised anywhere — the
subscription callback simply never fires. "Live pick outcomes"
(`architecture.md` § Request flow, `GameweekPage.jsx`'s own header text) had
never actually updated in real time in this environment, only via each hook's
own polling fallback (`refetchInterval`/`staleTime`). Not in any migration —
same out-of-band pattern as `ISSUE-1`/`ISSUE-21`/`ISSUE-24`.
`011_realtime_publication.sql` adds `fixtures`, `fixture_events`, and
`pick5_picks` to the publication (`fixture_player_status` deliberately excluded
— it isn't itself in any migration, `ISSUE-2`, so adding it would break replay
from an empty database; add it once that table gets a proper migration).
Verified live: `pg_publication_tables` now lists all three. Realtime respects
each subscriber's own RLS policies for `postgres_changes` — this is Supabase's
documented default behavior, unaffected by this fix — so no RLS/security
posture changed, only the previously-dead change-stream was restored.

#### ISSUE-30 — Undocumented `pots` DELETE policy allowed a pot's creator/admin to delete it directly
**Discovered and resolved 2026-08-05**, during the same audit. A live-only
policy, `"users can delete pots they admin"` (`DELETE`, authenticated, creator
or pot-admin), existed with no corresponding migration.
[database.md](./database.md)'s own RLS summary documents `pots` as having **no**
delete policy at all, by design. Deleting a pot cascades to
`pot_members`/`entry_payments`/`user_entries` (`on delete cascade`,
`001_initial_schema.sql`) — a real, irreversible data-loss path for a
capability the application never intended and no frontend code calls (confirmed
via grep: nothing in `frontend/src` ever calls `.from('pots').delete(...)`).
Dropped via `012_drop_undocumented_rls_policies.sql`. Verified live: `pots` now
has only the three documented commands (select/insert/update), no delete.

#### ISSUE-31 — Undocumented `leagues` INSERT policy allowed any authenticated user to write arbitrary reference data
**Discovered and resolved 2026-08-05**, during the same audit. A live-only
policy, `"allow import writes"` (`INSERT`, authenticated, `with check (true)`),
existed with no corresponding migration. `leagues` is reference data —
[database.md](./database.md) documents every reference table (seasons, leagues,
teams, players, gameweeks, fixtures, fixture_events) as read-only for clients,
written only by `sync-fixtures` via its service-role client, which bypasses RLS
and never needed this policy. `with check (true)` is the least-restrictive
check possible — the exact anti-pattern
[engineering-principles.md](./engineering-principles.md#security) warns against
("default to owner-only or pot-member-only access... not `using (true)` for
convenience"). Any signed-up user (self-serve signup exists) could have
inserted arbitrary rows into shared reference data, with no legitimate path
depending on the ability to do so. Dropped via
`012_drop_undocumented_rls_policies.sql`. Verified live: `leagues` now has only
the two (redundant, harmless) read policies.

#### ISSUE-1 — Pot creation likely violates its own RLS policy
**Resolved, confirmed live 2026-08-03** (verification, not a fix performed this
session). Live inspection of `pg_policy` on `pot_members` found an additional policy,
`"users can insert own admin membership"` (`insert with check ((user_id = auth.uid())
and (role = 'admin'::member_role))`), that isn't in `002_rls_policies.sql` — it lets
a user insert themselves as the first admin without needing to already be one,
directly resolving the circularity this issue originally described. **Not captured
in any migration** — same root cause as ISSUE-21 (an out-of-band change, likely via
the Supabase SQL Editor given `pot_members` is `postgres`-owned). Recommend this
policy gets captured properly in the Milestone 2+ baseline migration rather than
left as an undocumented fact about the live database.

#### ISSUE-5 — Repository has no git history; secrets aren't excluded from version control
**Resolved 2026-08-03.** The repository's single prior commit had, in fact, already
committed the root `.env` (containing a live Supabase service-role key, anon key, and
an api-football key) plus both Playwright chrome-profile directories (ISSUE-14),
because the root `.gitignore` was a 0-byte empty file — the risk this issue originally
described ("must be fixed before the first commit") had already materialized by the
time it was written. Since no remote was ever configured (`git remote -v` returned
nothing) and nothing had been pushed anywhere, the fix was a local history reset
rather than a filter-branch/BFG rewrite: the sole commit was un-made
(`git update-ref -d refs/heads/master`), `.env` and the chrome-profile directories were
untracked (`git rm --cached`, files kept on disk), a comprehensive root `.gitignore`
was added, and a `.env.example` with placeholder values was created. The repository
was then re-committed clean, so the secret no longer exists in any reachable commit.
**Residual, non-blocking:** the original commit object is still present locally as a
dangling object (recoverable via `git reflog`) until `git reflog expire --expire=now
--all && git gc --prune=now` is run — this is an irreversible prune, left for the repo
owner to run deliberately rather than performed automatically. See
[session-log.md](./session-log.md) for the full session record.

#### ISSUE-22 — Edge Runtime's default JWT verification rejected GoTrue's ES256 tokens; no authenticated Edge Function call worked locally
**Resolved 2026-08-04, fixed by a Supabase CLI/Edge Runtime upgrade.** Root cause
was proven 2026-08-03–04 (see git history of this file for the full original
investigation): the Edge Runtime's internal `verifyJWT` gate (not Kong, not
GoTrue) only knew a legacy shared HS256 secret and rejected every real,
ES256-signed user session token unconditionally, before any function code ran —
tracked upstream at
[supabase/cli#4453](https://github.com/supabase/cli/issues/4453) (a raw
`Uint8Array` vs `CryptoKey` type bug in the `jose`-based verification), closed
"not planned." At the time, upgrading was explicitly "not recommended as a fix"
because no changelog entry documented a corresponding fix.

**Re-verified from scratch 2026-08-04** after the user upgraded the Supabase CLI:
- **Versions confirmed, not assumed**: CLI `2.111.0` (was `2.75.0`); Edge Runtime
  `v1.74.2` (was `v1.70.0`) via `docker inspect`; GoTrue `v2.194.0` (was
  `v2.186.0`); Kong unchanged at `v2.8.1` (`KONG_PLUGINS=request-transformer,cors`,
  still no JWT plugin — confirms Kong was never the mechanism, consistent with the
  original root-cause finding).
- **Clean restart performed** (`supabase stop` / `supabase start`, genuinely new
  images pulled, not a reused container), all services healthy before testing
  (confirmed via `/health`).
- **Fresh, real-client test**: a brand-new user was signed up and signed in
  against local Auth (no reused tokens), then called via
  `supabase.functions.invoke()` — the actual `supabase-js` client path a real
  frontend uses, zero manual headers — against both `admin-actions` (pre-existing,
  unrelated function) and `get-or-create-pick5-entry` (Slice 1). JWT header
  confirmed still `ES256`-signed, same key as before — the client-side signing
  behavior did not change, only the Edge Runtime's ability to verify it.
  - `admin-actions` → `403` (not `401`): proves the JWT was verified and accepted;
    the `403` is the function's own authorization logic correctly rejecting a
    non-admin user — this is what correct behavior looks like, not a new failure.
  - `get-or-create-pick5-entry` → genuine `200` success payload
    (`{created: true, ...}`), a real row written to `game_entries` and
    `game_entry_pick5`.
  - Edge Runtime logs captured the definitive mechanism: `"Legacy token type
    detected, attempting HS256 verification"` immediately followed by successful
    request-serving log lines for `compute-scores`, `admin-actions`, and
    `get-or-create-pick5-entry` — the Edge Runtime now differentiates token types
    instead of assuming HS256 unconditionally, which is the fix.
- **Classification: ✅ Fixed by update.** Behavior changed from unconditional
  rejection to correct verification for both a pre-existing function and Slice 1's
  new function, with no application code changes on either side.
- Test data (the temporary user, `pot_members`, `game_entries`,
  `game_entry_pick5` rows) was cleaned up via direct SQL after verification;
  confirmed `auth.users` and `game_entries` row counts back to their pre-test
  values.

**Consequence**: the `verify_jwt = false` + `auth.getUser()` workaround
(objective 5 of the re-verification request) was evaluated as **not applicable**
— it was only being considered because ISSUE-22 was still open; since the
upgrade resolves it at the platform level, adopting a per-function workaround
for a problem that no longer exists would add unneeded complexity. No longer
blocks any Milestone 4+ slice. See [session-log.md](./session-log.md) for the
full investigation record, both the original root-cause phase and this
re-verification.

#### ISSUE-23 — `available_players_by_gameweek` never filtered out non-playing staff ('Coach')
**Discovered and resolved 2026-08-04**, while building `Pick5Engine.validateEntry()`
(Milestone 4, Slice 2). `public.players.position` has a live `'Coach'` value —
confirmed via `select distinct position from public.players`, which returned
`Coach, Defence, Goalkeeper, Midfield, Offence` — and
`available_players_by_gameweek` (`001_initial_schema.sql`) never excluded it. A
coach cannot score a goal, so any mode reading this view could have offered one as a
pickable/predictable "player." Not a product decision like ISSUE-7's goalkeeper
question — a coach is never a legitimate pick under any mode's rules, so this was
fixed at the shared view level, not inside Pick 5's own code:
`008_fix_available_players_view_excludes_coaches.sql` adds `and (p.position is null
or p.position <> 'Coach')` to the view. Verified live: `select distinct position from
available_players_by_gameweek` now returns only `Defence, Goalkeeper, Midfield,
Offence` — `Goalkeeper` still present at the view level, correctly, since excluding
it is Pick 5-specific business logic (ISSUE-7's resolution, above), not a shared-view
concern.

#### ISSUE-25 — `supabase.functions.invoke()` error handling swallowed the real Edge Function error message
**Discovered and resolved 2026-08-05**, during the Pick 5 frontend cutover's live
verification, while confirming `Pick5Engine.validateEntry()`'s locking rejection
surfaced correctly through the real UI. It didn't: the toast showed the generic
"Edge Function returned a non-2xx status code" instead of the actual server
message ("Entry is locked, not pending — picks can no longer be changed").
Root cause: `supabase-js`'s `functions.invoke()` throws a `FunctionsHttpError` on
any non-2xx response whose own `.message` is always that generic string — the
Edge Function's real JSON error body is only reachable via `error.context` (the
raw `Response`), which every call site (`hooks/useEntry.js`, `hooks/usePick5Entry.js`,
`pages/PotDetail.jsx`) was discarding by doing `if (error) throw error`. Not
previously caught because `hooks/usePick5Entry.js`'s two hooks (which have the
identical pattern) were written in Milestone 4 Slice 1 but never wired into any
page until this cutover — the bug existed in the repo for a full milestone with no
path that ever exercised it. Fixed with a single shared helper,
`extractFunctionError()` in `lib/supabase.js`, that parses `error.context.json()`
and returns a proper `Error` with the real message; used at all three call sites.
Verified live: re-attempting the same locked-entry edit through the real UI after
the fix correctly displayed the specific server message.

#### ISSUE-15 — Overall (cross-gameweek) leaderboard is never populated
**Resolved 2026-08-05, via the Pick 5 frontend cutover.** Originally:
`hooks/useLeaderboard.js` queried `leaderboard_snapshots` for `is_overall = true`
when no specific gameweek was requested, but `settle-gameweek` only ever wrote
`is_overall: false` rows, so the season-long leaderboard view always rendered
empty. `hooks/useLeaderboard.js` now reads `pot_standings_snapshots` instead —
written by `Pick5Engine.generateStandings()` (Milestone 4 Slice 6), which has
always written both a per-gameweek row and an overall row (`gameweek_id IS NULL`)
per user, per [game-engine.md § GE-4.6](./game-engine.md#ge-46-pot_standings_snapshots).
Verified live through the real UI (`GameweekPage.jsx`'s new Standings section,
added as part of the same cutover — no prior page rendered this data at all). See
[session-log.md](./session-log.md) for the cutover session.

#### ISSUE-14 — Chrome profile directories in the working tree
**Resolved 2026-08-03**, as part of the ISSUE-5 fix above — both
`frontend/.chrome-profile/` and `frontend/chrome-profile/` were untracked from git
(kept on disk) and are now excluded by the new root `.gitignore`. Whether to delete
them from disk entirely (they're only needed if the WhoScored scraper workflow
continues, per ISSUE-4) is a separate, not-yet-made decision.

#### ISSUE-36 — `reinstate_entry` (Late Payment Override) has no UI trigger
**Discovered 2026-08-09**, during the Phase 7 Stage 1 audit. **Resolved
2026-08-10**, Phase 7 Stage 2 Slice 4. The backend action was always fully
implemented and live-verified (`admin-actions`' `reinstate_entry` — see
[decisions.md § Late Payment Override](./decisions.md#late-payment-override));
it just had no frontend caller. `PaymentTable.jsx` now shows a "Reinstate
entry" button exactly where it's decidable (a void entry whose payment is
now marked paid — `usePaymentStatus()` extended to also resolve
`game_entries.status`/`reinstated_at`, same GE-4.5 gameweek/season-scope
split `reinstate.ts` itself already makes), gated behind a confirmation
modal. Zero backend changes. Live-verified: a void-but-now-paid Pick 5
entry was reinstated through the real UI and confirmed re-settled correctly
in the database via the existing `calculateScore()`/`settle()` recompute
pipeline.

#### ISSUE-35 — Season-scoped (LMS/Predictor) payments have no admin UI path
**Discovered 2026-08-09**, during the Phase 7 Stage 1 audit. **Resolved
2026-08-10**, Launch Readiness Sprint 1B. `pages/AdminPayments.jsx` was hard-
scoped to gameweek-scoped payments throughout: `usePaymentStatus` explicitly
filtered `.eq('scope', 'gameweek')`, and `handleMark`/the bulk-CSV flow always
passed a `gameweekId`. `admin-actions`' `mark_paid`/`mark_unpaid` already
supported season-scoped rows (`gameweek_id: null`) — only the frontend had no
path to call them without a gameweek. `record_payment` was the one genuine
backend gap: it threw outright for any non-Pick-5 pot. Fixed by dispatching
on `pots.game_type` (`handleWeeklyRecordPayment` — Pick 5's original logic,
unchanged in behavior — vs. the new `handleSeasonRecordPayment`, which
validates the amount matches the one-time entry fee exactly via the new pure
`validateSeasonPayment()` and reuses the existing `upsertEntryPayment()`
get-or-create-by-id write). `AdminPayments.jsx` now branches on
`selectedPot.game_type`: the gameweek selector and Bulk CSV import section
(deliberately left Pick 5-only — not requested for LMS/Predictor) only render
for Pick 5; "Record payment received" and "Entries awaiting verification"
render for every mode, with the payment preview branching on the response's
`scope` (`'gameweek'` — the existing per-week allocation chips — vs.
`'season'` — a simple paid-status-before/after view).
`PaymentTable.jsx`'s mark-paid button label is now mode-aware ("Mark paid"
vs. "Mark paid for this week"). Also found and removed while reviewing
`mark_unpaid`: a dead write to the retired `user_entries` prototype table
that could never match any row (see
[decisions.md § Season Payment Management (ISSUE-35)](./decisions.md#season-payment-management-issue-35)
for the full bug writeup). Live-verified end to end: LMS and Score Predictor
payment preview/confirm, mark paid/unpaid, reinstate, and a Pick 5 regression
pass, all through the real UI against a local database with zero residue
after cleanup.

#### ISSUE-9 — `/admin` has no UI-level role gate
**Discovered** at initial documentation; **re-verified, not assumed, 2026-08-10**
directly against the then-current `App.jsx` before any fix was written — confirmed
still true (`/admin`/`/admin/payments`/`/admin/rollovers` sat behind
`ProtectedRoute` alone; `TopNav.jsx`/`BottomNav.jsx` showed the "Admin" link
unconditionally to every signed-in user, with no client-side admin concept
anywhere). **Resolved 2026-08-10**, Launch Readiness Sprint 1A. A new `AdminRoute`
guard (`App.jsx`) wraps the whole `/admin/*` route group: unauthenticated →
redirected to `/sign-in`; authenticated but neither an app admin
(`user.app_metadata.role === 'app_admin'`) nor a pot admin of any pot
(`pot_members.role = 'admin'`, any row) → a new `NotAuthorized.jsx` page, not a
silent bounce. `usePotsForAdmin`/`AdminPayments`/`AdminRollovers` are genuinely
meant for any pot organiser (each already scopes its own content to pots the
caller administers via existing RLS), so "pot admin of at least one pot" — not
"app admin only" — is the correct bar for the shared subtree; `AdminDashboard`'s
own platform-wide "Manual jobs" section is separately hidden for non-app-admins
specifically, since the backend now gates those four functions on `app_admin`
alone (see `ISSUE-26`, below). The "Admin" nav link in `TopNav.jsx`/`BottomNav.jsx`
is also now conditionally shown — an additional layer, explicitly not the actual
protection, which is the route guard itself. Live-verified, real browser: an
anonymous visitor hitting `/admin/payments` directly was redirected to
`/sign-in`; a signed-in user with zero admin relationships anywhere saw
"Not authorised" with the "Admin" nav link correctly absent; a real pot admin
(no `app_admin` claim) was granted access with "Manual jobs" correctly hidden;
the same user, after a temporary `app_admin` claim (reverted and independently
re-confirmed afterward), saw "Manual jobs" and successfully triggered
"Compute live scores" through the real UI end-to-end.

#### ISSUE-26 — `compute-deadlines`/`compute-scores`/`settle-gameweek`/`sync-fixtures` accepted unauthenticated requests
**Discovered 2026-08-05**, scope extended to `sync-fixtures` 2026-08-09; **all
four re-verified, not assumed, 2026-08-10** via a fresh source read of each
function before writing any fix — confirmed still true: none of the four read
or verified an `Authorization` header, each built a service-role client
unconditionally, and Kong's default `verify_jwt` only demands *some* valid JWT
— the public anon key, embedded in the frontend bundle, satisfies it — not a
specific caller. **Resolved 2026-08-10**, Launch Readiness Sprint 1A. A new
shared helper, `_shared/adminOrCronAuth.ts`, requires one of exactly two
callers — an exact match against the function's own `SUPABASE_SERVICE_ROLE_KEY`
(the real cron caller; confirmed live via `cron.job`'s actual current
`command` text that every scheduled job sends `Authorization: Bearer
<service_role_key>` + a matching `apikey` header, not inferred from a
migration file alone — the live `cron.job` table has some drift from the
migrations, e.g. an undocumented `lock-due-entries-every-minute` job calling a
plain SQL function, so this was checked directly), or a signed-in user with
`app_metadata.role === 'app_admin'` (`AdminDashboard.jsx`'s "Manual jobs"
buttons call these same functions with the user's own session token, not the
service-role key — deliberately not broken by this fix, exactly the product
decision this issue's own prior note called for rather than a blind
service-role-only lockdown). Mirrors `admin-actions/index.ts`'s own
already-proven auth shape rather than inventing a new one. Live-verified via
direct HTTP calls to each of the four functions: the public anon key now gets
`401` on all four (previously `200`); the service-role key still gets a normal
response (`sync-fixtures`' `500` is a pre-existing, unrelated
`competitionId`-not-provided error, confirmed by its error body, not an auth
failure); the real, unmodified cron jobs continued succeeding every 1-3
minutes throughout, confirmed via `AdminDashboard.jsx`'s own live sync log.
`sync-live-events` cron job (`ISSUE-4`) was not touched — the Edge Function it
targets still doesn't exist, unrelated to this fix, out of this sprint's scope
per its own explicit "do not redesign the scheduler architecture" instruction.

*(when a future issue is fixed and verified, move its entry here with the date, and a
reference to the commit/PR that fixed it, instead of deleting it.)*

## Verification status

Which P0 items have actually been checked against the live Supabase project, as
opposed to inferred from the migrations in this repo:

| Issue | Checked against live DB? | Date | Result |
|---|---|---|---|
| ISSUE-1 (pot creation RLS) | **Yes** | 2026-08-03 | Resolved — an undocumented policy fixes it, see [Resolved issues](#resolved-issues) |
| ISSUE-2 (`fixture_player_status`) | **Yes** | 2026-08-03 | Table exists live — confirms this is a migration gap, not a broken frontend |
| ISSUE-3 (materialized view refresh) | **Yes** | 2026-08-03 | Confirmed never refreshed — but moot in practice today, since ISSUE-19 means no data ever reaches it anyway |
| ISSUE-4 (`sync-live-events` cron failures) | **Yes** | 2026-08-03 | Confirmed failing on every run — see ISSUE-19 for the full pipeline-wide root cause |
| ISSUE-19 (cron pipeline failure) | **Yes** | 2026-08-03 | Confirmed 100% failure rate since the earliest recorded run — see entry above |
| ISSUE-20 (prototype RLS/anon-write exposure) | **Yes** | 2026-08-03 | Confirmed live and still open |
| ISSUE-21 (ownership split) | **Yes** | 2026-08-03 | Confirmed live and still open |
| ISSUE-22 (Edge Runtime JWT verification) | **Yes** | 2026-08-04 | Resolved by CLI/Edge Runtime upgrade, see [Resolved issues](#resolved-issues) |
| ISSUE-24 (conflicting `deadline_utc` triggers) | **Yes** | 2026-08-05 | Confirmed live via direct, controlled reproduction — real bug, still open |

Update this table the first time each item is actually checked, even if the result is
"confirmed broken" — an unverified guess and a confirmed fact should not look the same
on this page.
