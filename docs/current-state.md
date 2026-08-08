# Current State

Last reviewed: 2026-08-05.

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
- **Strategic direction (updated 2026-08-05):** the product is being rebuilt as a
  three-game-mode platform (Pick 5, Last Man Standing, Score Predictor), all
  launch-quality, all first-class — see [game-engine.md](./game-engine.md), now the
  authoritative architecture spec. Milestones 1–4 are complete: specification,
  shared schema design, Game Engine framework, and the full Pick 5 implementation
  (all 8 `GameEngine` methods) — see
  [game-engine.md § GE-12](./game-engine.md#ge-12-milestone-plan). **This is now the
  live, real-user path for Pick 5**, not just backend code: the frontend cutover
  (2026-08-05) rewired `PicksPage.jsx`/`PotDetail.jsx`/`GameweekPage.jsx` and their
  hooks onto `get-or-create-pick5-entry`/`submit-pick5-picks`/`game_entries`/
  `pick5_picks`/`pot_standings_snapshots`, verified end-to-end through the real UI.
  No frontend code creates a `user_entries` row anymore. Milestone 5 (Last Man
  Standing) has not started. The previously-undocumented `supabase_admin`-owned
  LMS/Predictor prototype tables/functions Milestone 4 replaces are treated as
  retired business-intent signal, not a preserved implementation — see
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

#### ISSUE-24 — An undocumented SQL trigger recomputes `gameweeks.deadline_utc` with a conflicting, incorrect offset
**Discovered and confirmed live 2026-08-05**, by accident, during Milestone 4 Slice
6's live verification (unrelated to Slice 6's own work — surfaced while
temporarily flipping a fixture's status for a settlement test). `deadline_utc`
kept reverting to a value inconsistent with `compute-deadlines`' own formula
immediately after any change to a row in `fixtures`, with no Edge Function
involved. Root-caused via `information_schema.triggers`: `fixtures` has an
`AFTER INSERT OR UPDATE OR DELETE` trigger,
`trg_refresh_gameweek_deadlines_on_fixtures`, calling
`trigger_refresh_gameweek_deadlines()`, which calls `refresh_gameweek_deadlines()`
— a SQL function that recomputes **every** gameweek's `earliest_kickoff_utc`/
`deadline_utc` from `fixtures` directly, using
`earliest_kickoff_utc - interval '15 minutes'`.

This **conflicts with** `compute-deadlines/index.ts`'s formula (`earliest - 30
minutes`) and with the documented business rule
([business-rules.md § When picks lock](./business-rules.md#when-picks-lock):
"30 minutes before the earliest kickoff... one single deadline for the whole
gameweek"). Both mechanisms write the same column; whichever ran most recently
wins — in practice, since any real fixture status change (a normal, frequent
occurrence via `sync-fixtures`/`sync-live-events`) fires this trigger
immediately, the *documented* 30-minute deadline is silently overwritten by an
undocumented 15-minute one on essentially every live update, not just
occasionally.

**Confirmed via direct, controlled reproduction** (not inferred): a real,
isolated `compute-deadlines` invocation correctly set gameweek 9's
`deadline_utc` to `18:30:00` (matching `19:00:00 earliest_kickoff_utc - 30
min`, and matching the row's own already-consistent `earliest_kickoff_utc`);
a subsequent plain `UPDATE fixtures SET status = ...` on that gameweek's one
fixture — no Edge Function call at all — immediately changed it to
`18:45:00` (`19:00:00 - 15 min`). **Re-confirmed a third time** later the
same session, purely from background activity: with no deliberate change to
gameweek 9's own fixture at all, `deadline_utc` drifted back to `18:45:00`
again. `refresh_gameweek_deadlines()`'s single `UPDATE ... FROM (... group by
gameweek_id)` recomputes **every** gameweek in one statement, so it doesn't
need anyone to touch a *specific* gameweek's own fixture — any write
anywhere in the `fixtures` table (routine background sync activity) fires
the trigger and re-derives all gameweeks' deadlines with the wrong offset.
This is continuous, ambient drift, not an occasional coincidence.

**Not in any migration** — confirmed via `grep` across
`supabase/migrations/`, zero matches for either function/trigger name. Owned
by `supabase_admin`, matching the same out-of-band, undocumented-prototype
pattern as [ISSUE-1](#issue-1--pot-creation-likely-violates-its-own-rls-policy)'s
policy and [ISSUE-21](#issue-21--postgres-role-cannot-alter-supabase_admin-owned-prototype-objects)'s
ownership split — created directly against the live database at some point,
never captured as a migration.

**Impact:** real, not cosmetic. If this trigger fires after `compute-deadlines`
computes the correct 30-minute deadline (the common case, since fixture
updates are frequent), the live deadline enforced by the rest of the system is
15 minutes before kickoff, not 30 — a fairness/correctness gap directly
affecting real-money pots, on top of the already-known
[ISSUE-17](#issue-17--leaderboard-ranking-has-no-tie-break-rule) tie-break
gap. **Not fixed as part of Slice 6** — entirely unrelated to that slice's
scope (`generateStandings()`/`ISSUE-15`/`ISSUE-17`); flagged here for a
deliberate decision on which value is actually correct (this repo's own
documentation says 30 minutes) before either removing the trigger or updating
`compute-deadlines` to match it.

#### ISSUE-26 — `compute-deadlines`/`compute-scores`/`settle-gameweek` accept unauthenticated requests
**Discovered 2026-08-05**, during the production hardening sprint audit. Unlike
`get-or-create-pick5-entry`/`submit-pick5-picks`/`admin-actions` (all of which
require and verify a caller JWT), these three Edge Functions have no
`Authorization` check at all — any caller with the public anon key (embedded in
the frontend bundle, or trivially obtainable) can invoke settlement, scoring, or
deadline computation directly and repeatedly, with `settle-gameweek` additionally
accepting an arbitrary `gameweek_id` body parameter. Broader and more specific
than `ISSUE-9` (which is scoped to `/admin`'s missing UI-level role gate) — this
is the underlying Edge Functions themselves having no server-side authentication,
and it now also gates money-moving logic (`Pick5Engine.awardPrize()`) since the
Pick 5 frontend cutover. **Status: confirmed, not fixed.** Mitigated somewhat by
idempotency (repeated calls are safe no-ops) and by `settle-gameweek`'s "all
fixtures finished" gate (blocks premature settlement, not abusive/repeated
invocation). **Deliberately not fixed in the hardening sprint**: `AdminDashboard.jsx`'s
"Manual jobs" buttons (`hooks/useAdmin.js:useTriggerSync`) call these same three
functions using the signed-in user's own session token, not the service-role key
— a naive "service-role-only" gate would silently break that existing, real
UI feature. The correct fix needs a product decision (mirror `admin-actions`'
pattern: allow either a valid app-admin session or the service-role key), not a
blind lockdown; flagging for a deliberate pass rather than guessing.

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

#### ISSUE-2 — `fixture_player_status` table missing from migrations
Live, reachable frontend code (`hooks/useEntry.js:useFixturePlayerStatuses`,
`hooks/useLiveScores.js`, `pages/GameweekPage.jsx`) reads from and subscribes to a
`fixture_player_status` table that is not defined in any file under
`supabase/migrations/`. Full column-level detail:
[database.md § Schema drift](./database.md#schema-drift). **Status: unverified.**
Either the deployed database has this table from an unversioned/manual change, in
which case a migration should be written to capture its current shape, or the
gameweek page's player-appearance UI (starting/bench/subbed badges) is currently
broken against a from-migrations-only database. Plan:
[roadmap.md § P0](./roadmap.md#p0--verify-or-fix-before-building-further-on-potsscoring).

#### ISSUE-3 — `player_fixture_goals` materialized view is never refreshed
`compute-scores` (edge function, on a 3-minute cron) reads live goal counts from the
`player_fixture_goals` materialized view. Nothing in the repository — no edge
function, no cron job, no script — ever calls
`select public.refresh_player_fixture_goals()`. Mechanism detail:
[database.md § player_fixture_goals](./database.md#player_fixture_goals-materialized-view).
**Status: unverified.** If nothing refreshes this view out-of-band (e.g. a
dashboard-configured cron job not captured in `supabase/migrations/`), live scoring
is silently computing results against stale — possibly permanently empty — goal
counts, with no error raised anywhere. Plan:
[roadmap.md § P0](./roadmap.md#p0--verify-or-fix-before-building-further-on-potsscoring).

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

### P1 — features that are half-built or internally inconsistent

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

#### ISSUE-8 — No self-serve pot-join flow
`pots.invite_code` exists in the schema (unique-constrained — see
[database.md § pots](./database.md#pots)) but no frontend code reads, generates, or
redeems it. The only ways to become a pot member are (a) being the creator, or (b) an
existing pot admin using `admin-actions`' `add_member` action — which itself has no
UI trigger (the components that would call it are the same unwired `MemberTable.jsx`
from ISSUE-6). **Status: confirmed.** This looks like a feature that was started
(the column and its unique constraint exist) and not finished. Plan:
[roadmap.md § P1](./roadmap.md#p1--close-the-loop-on-features-that-are-half-built).

#### ISSUE-9 — `/admin` has no UI-level role gate
`App.jsx`'s route table puts `/admin` behind `ProtectedRoute` (must be signed in) but
not behind any admin check — any authenticated user can navigate to it and trigger
`sync-fixtures`, `compute-scores`, and `settle-gameweek`. Of the edge functions it
calls, only `admin-actions` checks the caller's role server-side; the
sync/compute/settle functions have no auth check at all (see
[api.md § Edge Functions](./api.md#2-edge-functions) for each function's auth
posture). **Status: confirmed.** Low real-world severity today since `AdminDashboard`
doesn't call `admin-actions` (see ISSUE-6), but the sync/compute/settle triggers are
live and callable by anyone. Plan:
[roadmap.md § P1](./roadmap.md#p1--close-the-loop-on-features-that-are-half-built).

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

### P2 — cleanup and consolidation (tech debt, not incorrect behavior)

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
`components/entryBuilder.jsx`, `lib/gameAPI.js`, `lib/footballDataProvider.js`, and
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

#### ISSUE-12 — Overlapping, unused football-data.org sync scripts
Three standalone Node scripts (`frontend/scripts/fullSyncInsert.js`,
`fullSyncPlayers.js`, `syncFootballData.js`) each independently implement
similar-but-not-identical upsert logic against football-data.org v4, none of them
invoked by the running app, cron, or any edge function. See
[architecture.md § Three football data providers](./architecture.md#three-football-data-providers)
and [decisions.md § Provider abstraction was planned but never completed](./decisions.md#provider-abstraction-was-planned-but-never-completed)
for how this relates to the (also unused) `footballDataProvider.js` abstraction.
**Status: confirmed.** Plan: [roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

#### ISSUE-13 — Duplicate `.env` files
A root-level `.env` and `frontend/.env.local` contain the same keys (Supabase URL/
anon key/service-role key, football-data.org key, competition code/season). The root
copy doesn't appear to be read by anything — see
[architecture.md § Environment configuration](./architecture.md#environment-configuration)
for the reasoning. Related to, but distinct from, the more urgent security question
in ISSUE-5 (the root copy isn't gitignored). **Status: confirmed.** Plan:
[roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

#### ISSUE-18 — `useAuth.js` logs the signed-in user's email to the browser console
`hooks/useAuth.js`'s `onAuthStateChange` handler calls `console.log('auth changed',
session?.user?.id, session?.user?.email)` on every auth state change. Low severity —
visible only to the signed-in user in their own browser devtools, not exposed to
anyone else — but it's a debug statement that shouldn't have shipped, and it's the
kind of thing [engineering-principles.md § Logging](./engineering-principles.md#logging)
now exists to prevent recurring. **Status: confirmed.** Plan:
[roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

### P3 — known product gaps (unbuilt, not broken)

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
